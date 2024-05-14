import datetime
import json

from django.contrib.auth.decorators import login_required
from django.db import models
from django.db.models import Count
from django.db.models import Max
from django.db.models import Prefetch
from django.db.models import Q
from django.http import HttpResponseForbidden
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.shortcuts import redirect
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_GET
from django.views.decorators.http import require_POST

from tracker.task.models import Floor
from tracker.task.models import Room
from tracker.task.models import Task
from tracker.task.models import Workspace


@login_required
def index(request):
    user = request.user
    default_workspace = user.default_workspace
    workspace = user.workspaces.all()

    # Prefetch floors with related rooms
    floors_prefetch = Prefetch("floors__rooms", queryset=Room.objects.all())
    # Use prefetch_related to optimize fetching of related objects
    selected_workspace_id = request.session.get("selected_workspace_id", None)

    # Get the selected workspace ID from the session
    all_workspaces = Workspace.objects.filter(users=user).prefetch_related(
        floors_prefetch,
    )

    workspace = all_workspaces.get(id=selected_workspace_id)
    # todo what if the selected_workspace_id is not in the user's workspaces?
    # todo can that even be possible?
    # todo maybe add validation for that idk lol :D

    # Since tasks are related to rooms, they will be fetched
    # as part of the rooms prefetch
    context = {
        "default_workspace": default_workspace,
        "workspace": workspace,
        "all_workspaces": all_workspaces,
    }

    set_sidebar_floors(request, selected_workspace_id)

    return render(request, "task/index.html", context)


@login_required
@require_POST
def set_workspace(request):
    workspace_id = request.POST.get("workspace_id")
    # todo: validate that the given workspace_id is associated with the user.
    if workspace_id:
        request.session["selected_workspace_id"] = workspace_id
        set_sidebar_floors(request, workspace_id)

    return redirect(reverse("task:index"))


@login_required
@require_POST
def add_floor(request):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    workspace_id = request.POST.get("workspace_id")
    floor_name = request.POST.get("floor_name")
    floor_color = request.POST.get("floor_color")
    floor_emoji = request.POST.get("floor_emoji")

    workspace = get_object_or_404(Workspace, id=workspace_id, users=request.user)
    Floor.objects.create(
        name=floor_name,
        workspace=workspace,
        icon=floor_emoji,
        color=floor_color,
    )
    return redirect(reverse("task:index"))


@login_required
@require_POST
def remove_floor(request, floor_id):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)
    floor.delete()
    return redirect(reverse("task:index"))


@login_required
@require_POST
def add_room(request):
    # debug
    # params = request.POST
    # write_to_log(str(params))
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    floor_id = request.POST.get("floor_id")
    room_name = request.POST.get("room_name")
    room_icon = request.POST.get("room_emoji")
    floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)
    Room.objects.create(name=room_name, floor=floor, icon=room_icon)
    return redirect(reverse("task:index"))


@login_required
@require_POST
def edit_floor(request, floor_id):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()

    # Get the floor instance
    floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)

    # Update the floor details from POST data
    floor_name = request.POST.get("floor_name")
    floor_color = request.POST.get("floor_color")
    floor_emoji = request.POST.get("floor_emoji")

    if floor_name:
        floor.name = floor_name
    if floor_color:
        floor.color = floor_color
    if floor_emoji:
        floor.icon = floor_emoji

    # Save the updated floor
    floor.save()

    # Redirect to a specific page, e.g., a floor detail page or back to index
    return redirect(reverse("task:index"))


@login_required
@require_GET
def fetch_tasks(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    floor_id = request.GET.get("floor_id")
    room_id = request.GET.get("room_id")
    completed = request.GET.get("completed") == "true"

    if not floor_id and not room_id:
        return JsonResponse({"error": "No floor or room id provided"}, status=400)

    if floor_id and room_id:
        return JsonResponse(
            {"error": "Both floor and room id provided. Please provide only one."},
            status=400,
        )

    tasks = Task.objects.none()  # Initialize with no tasks

    if floor_id:
        floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)
        rooms = floor.rooms.all()
        num_rooms = rooms.count()

        # Fetch tasks associated with at least all rooms on this floor
        tasks = (
            Task.objects.annotate(
                num_rooms_on_floor=Count(
                    "rooms", filter=Q(rooms__in=rooms), distinct=True
                ),
                custom_order=models.Case(
                    models.When(category="urgent", then=models.Value(1)),
                    models.When(category="special", then=models.Value(2)),
                    models.When(category="normal", then=models.Value(3)),
                    default=models.Value(4),
                    output_field=models.IntegerField(),
                ),
            )
            .filter(num_rooms_on_floor=num_rooms)
            .order_by("custom_order", "-modified_date")
            .distinct()
        )

        # Filter tasks based on completion status
        if completed:
            tasks = tasks.filter(status="done")
        else:
            tasks = tasks.exclude(status="done")

    if room_id:
        room = get_object_or_404(Room, id=room_id, floor__workspace__users=request.user)
        tasks = Task.objects.filter(rooms=room)

        # Apply the same completion filter to room-specific tasks
        if completed:
            tasks = tasks.filter(status="done")
        else:
            tasks = tasks.exclude(status="done")

    task_data = [
        {
            "id": task.id,
            "task_name": task.task_name,
            "task_description": task.task_description,
            "status": task.status,
            "type": task.type,
            "category": task.category,
            "due_date": task.due_date.isoformat() if task.due_date else None,
            "creation_date": task.creation_date.isoformat(),
            "modified_date": task.modified_date.isoformat()
            if task.modified_date
            else None,
            "completed_date": task.completed_date.isoformat()
            if task.completed_date
            else None,
            "rooms": {room.id: room.name for room in task.rooms.all()},
        }
        for task in tasks
    ]

    return JsonResponse(task_data, safe=False)


@login_required
def fetch_latest_task_timestamp(request):
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    floor_id = request.GET.get("floor_id")
    room_id = request.GET.get("room_id")

    if not floor_id and not room_id:
        return JsonResponse({"error": "No floor or room id provided"}, status=400)

    if floor_id and room_id:
        return JsonResponse(
            {"error": "Both floor and room id provided. Please provide only one."},
            status=400,
        )

    tasks = Task.objects.none()  # Initialize with no tasks

    if floor_id:
        floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)
        rooms = floor.rooms.all()
        num_rooms = rooms.count()

        tasks = Task.objects.annotate(
            num_rooms_on_floor=Count("rooms", filter=Q(rooms__in=rooms), distinct=True)
        ).filter(num_rooms_on_floor=num_rooms)

    if room_id:
        room = get_object_or_404(Room, id=room_id, floor__workspace__users=request.user)
        tasks = Task.objects.filter(rooms=room)

    latest_timestamp = tasks.aggregate(latest=Max("modified_date"))["latest"]

    return JsonResponse(
        {"latest_timestamp": latest_timestamp.isoformat() if latest_timestamp else None}
    )


@login_required
@require_POST
def remove_room(request, room_id):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    room = get_object_or_404(Room, id=room_id, floor__workspace__users=request.user)
    room.delete()
    return redirect(reverse("task:index"))


@login_required
def room_view(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    all_tasks = (
        Task.objects.filter(rooms=room)
        .annotate(
            custom_order=models.Case(
                models.When(category="urgent", then=models.Value(1)),
                models.When(category="special", then=models.Value(2)),
                models.When(category="normal", then=models.Value(3)),
                default=models.Value(4),
                output_field=models.IntegerField(),
            )
        )
        .order_by("custom_order", "-modified_date")
        .distinct()
    )

    # Separate tasks into exclusive and general
    exclusive_tasks = [task for task in all_tasks if task.rooms.count() == 1]
    general_tasks = [task for task in all_tasks if task.rooms.count() > 1]

    all_floors = Floor.objects.all().prefetch_related("rooms__tasks")

    params = {
        "view_type": "room",
        "room_id": room.id,
        "room_floor_id": room.floor.id,
        "room": room,
        "exclusive_tasks": exclusive_tasks,
        "general_tasks": general_tasks,
        "floors": all_floors,
        "today": timezone.now(),
    }

    return render(request, "room_view.html", params)


@login_required
def floor(request, floor_id):
    floor = get_object_or_404(Floor, pk=floor_id)

    return render(
        request,
        "task/floor.html",
        {
            "floor_id": floor.id,
            "floor": floor,
            "today": timezone.now(),
        },
    )


@login_required
@require_POST
def create_task(request):
    if request.method != "POST":
        return JsonResponse({"status": "error", "error": "Invalid request method"})

    # Adapt form field names as necessary based on your modal's form
    task_name = request.POST.get("taskName")
    task_description = request.POST.get("taskDescription")
    due_date = request.POST.get("dueDate")
    task_type = request.POST.get("type")
    task_category = request.POST.get("category")
    room_ids = request.POST.getlist("roomIDs")

    # Make variables null if they are empty strings
    task_name = task_name or None
    task_description = task_description or None
    due_date = due_date or None
    task_type = task_type or None
    task_category = task_category or None
    room_ids = room_ids or []

    # Ensure room_ids are integers
    room_ids = [int(id) for id in room_ids]

    if not room_ids:
        return JsonResponse({"status": "error", "error": "No rooms selected"})

    # Convert due_date from string to datetime object, if not empty
    if due_date:
        due_date = timezone.make_aware(
            datetime.datetime.strptime(due_date, "%Y-%m-%d"),
        )

    task = Task.objects.create(
        task_name=task_name,
        task_description=task_description,
        due_date=due_date,
        type=task_type,
        category=task_category,
        modified_date=timezone.now(),
    )

    # todo: room ids must be validated - they must belong to a floor in the currently selected workspace
    # Add rooms to the task if applicable
    for room_id in room_ids:
        task.rooms.add(Room.objects.get(id=room_id))

    return JsonResponse({"status": "success"})


@login_required
@require_POST
def update_task(request):
    try:
        data = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"status": "error", "message": "Invalid JSON"}, status=400)

    required_fields = ["task_id", "field_name", "value"]
    if not all(field in data for field in required_fields):
        return JsonResponse(
            {"status": "error", "message": "Missing required field(s)."},
            status=400,
        )

    task = get_object_or_404(Task, id=data["task_id"])
    selected_workspace = request.session.get("selected_workspace_id")
    if not task_belongs_to_workspace(task, selected_workspace):
        return JsonResponse(
            {
                "status": "error",
                "message": "Task does not belong to the selected workspace.",
            },
            status=400,
        )

    editable_fields = {
        "task_name",
        "task_description",
        "status",
        "type",
        "category",
        "due_date",
        "description",
        "rooms",
    }
    if data["field_name"] not in editable_fields:
        return JsonResponse(
            {
                "status": "error",
                "message": f"Invalid task field '{data['field_name']}'. Allowed fields: {editable_fields}",
            },
            status=400,
        )

    # General field update, except for special cases
    if data["field_name"] != "rooms":
        setattr(task, data["field_name"], data["value"])

        if data["field_name"] == "status" and data["value"] == "done":
            task.completed_date = timezone.now()

        task.modified_date = timezone.now()
        task.save()

    # Special handling for rooms
    elif data["field_name"] == "rooms":
        rooms = Room.objects.filter(id__in=data["value"])
        task.rooms.set(rooms)  # Reduces database hits

    return JsonResponse({"status": "success"})


def set_sidebar_floors(request, workspace_id):
    """
    Sets the selected workspace and floor in the user's session.

    Parameters:
        request (HttpRequest): The request object.
        workspace_id (int): The ID of the workspace to set as the selected workspace.

    Returns:
        None: The function does not return anything.
    """
    user = request.user
    floors_prefetch = Prefetch("floors__rooms", queryset=Room.objects.all())

    all_workspaces = Workspace.objects.filter(users=user).prefetch_related(
        floors_prefetch,
    )

    workspace = all_workspaces.get(id=workspace_id)
    floors = Floor.objects.filter(workspace=workspace)
    rooms = []
    for floor in floors:
        rooms += floor.rooms.all()

    sidebar_floors = [
        {
            "name": floor.name,
            "id": floor.id,
            "color": floor.color,
            "icon": floor.icon,
            "rooms": [
                {
                    "id": room.id,
                    "name": room.name,
                    "icon": room.icon,
                }
                for room in rooms
                if room.floor == floor
            ],
        }
        for floor in floors
    ]

    request.session["sidebar_floors"] = sidebar_floors


# helper function checks whether a task belongs to the user's currently selected workspace, returns bool:
def task_belongs_to_workspace(task: Task, workspace_id: int) -> bool:
    selected_workspace = Workspace.objects.get(
        id=workspace_id,
    )

    task_rooms = task.rooms.all()
    selected_workspace_floors = Floor.objects.filter(workspace=selected_workspace)

    first_room = task_rooms[0]
    first_room_floor = first_room.floor
    if first_room_floor not in selected_workspace_floors:
        return False

    return True


def write_to_log(string):
    with open("ivan_log.txt", "a") as file:
        file.write(string + "\n")
