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
from django.views.decorators.csrf import csrf_exempt
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

    # Since tasks are related to rooms, they will be fetched efficiently as part of the rooms prefetch
    context = {
        "default_workspace": default_workspace,
        "workspace": workspace,
        "all_workspaces": all_workspaces,
    }

    return render(request, "task/index.html", context)


@require_POST
def set_workspace(request):
    workspace_id = request.POST.get("workspace_id")
    # todo: validate that the given workspace_id is associated with the user.
    if workspace_id:
        request.session["selected_workspace_id"] = workspace_id
    return redirect(reverse("task:index"))


@require_POST
def add_floor(request):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    workspace_id = request.POST.get("workspace_id")
    floor_name = request.POST.get("floor_name")
    workspace = get_object_or_404(Workspace, id=workspace_id, users=request.user)
    Floor.objects.create(name=floor_name, workspace=workspace)
    return redirect(reverse("task:index"))


@require_POST
def remove_floor(request, floor_id):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)
    floor.delete()
    return redirect(reverse("task:index"))


@require_POST
def add_room(request):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    floor_id = request.POST.get("floor_id")
    room_name = request.POST.get("room_name")
    floor = get_object_or_404(Floor, id=floor_id, workspace__users=request.user)
    Room.objects.create(name=room_name, floor=floor)
    return redirect(reverse("task:index"))


@require_POST
def remove_room(request, room_id):
    if not request.user.is_authenticated:
        return HttpResponseForbidden()
    room = get_object_or_404(Room, id=room_id, floor__workspace__users=request.user)
    room.delete()
    return redirect(reverse("task:index"))


@require_POST
def create_task(request):
    if request.method == "POST":
        # Adapt form field names as necessary based on your modal's form
        task_name = request.POST.get("taskName")
        task_description = request.POST.get("taskDescription")
        due_date = request.POST.get("dueDate")
        task_type = request.POST.get("type")
        task_category = request.POST.get("category")
        room_ids = request.POST.getlist("rooms[]")  # Assumes multiple select for rooms

        # Make variables null if they are empty strings
        task_name = task_name or None
        task_description = task_description or None
        due_date = due_date or None
        task_type = task_type or None
        task_category = task_category or None
        room_ids = room_ids or []

        # Ensure room_ids are integers
        room_ids = [int(id) for id in room_ids]

        # Convert due_date from string to datetime object, if not empty
        if due_date:
            due_date = timezone.make_aware(
                datetime.datetime.strptime(due_date, "%Y-%m-%d"),
            )

        # Adapt task creation to your model structure
        task = Task.objects.create(
            task_name=task_name,
            task_description=task_description,
            due_date=due_date,
            type=task_type,
            category=task_category,
            modified_date=timezone.now(),
            # Add other necessary fields
        )
        # todo: remove logic that adds tasks, log params, check what room ids are given.
        # todo: room ids must be validated - they must belong to the currently selected workspace
        # Add rooms to the task if applicable
        for room_id in room_ids:
            task.rooms.add(Room.objects.get(id=room_id))

        return JsonResponse({"status": "success"})

    return JsonResponse({"status": "error", "error": "Invalid request method"})
