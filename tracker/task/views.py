import datetime

from django.contrib.auth.decorators import login_required
from django.db.models import Prefetch
from django.http import HttpResponseForbidden
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.shortcuts import redirect
from django.shortcuts import render
from django.urls import reverse
from django.utils import timezone
from django.views.decorators.http import require_POST

from tracker.task import models
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

    return render(request, "task/index.html", context)


@login_required
@require_POST
def set_workspace(request):
    workspace_id = request.POST.get("workspace_id")
    # todo: validate that the given workspace_id is associated with the user.
    if workspace_id:
        request.session["selected_workspace_id"] = workspace_id
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
    params = request.POST
    write_to_log(str(params))
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
def floor_view(request, floor_id):
    floor = get_object_or_404(Floor, pk=floor_id)
    tasks = (
        Task.objects.filter(rooms__floor=floor)
        .annotate(
            custom_order=models.Case(
                models.When(category="urgent", then=models.Value(1)),
                models.When(category="special", then=models.Value(2)),
                models.When(category="normal", then=models.Value(3)),
                default=models.Value(4),
                output_field=models.IntegerField(),
            ),
        )
        .order_by("custom_order", "-modified_date")
        .distinct()
    )

    all_floors = Floor.objects.all().prefetch_related("rooms__tasks")
    return render(
        request,
        "floor_view.html",
        {
            "view_type": "floor",
            "floor_id": floor.id,
            "floor": floor,
            "tasks": tasks,
            "floors": all_floors,
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


def write_to_log(string):
    with open("ivan_log.txt", "a") as file:
        file.write(string + "\n")
