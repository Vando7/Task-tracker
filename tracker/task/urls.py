# task/urls.py
from django.urls import path

from . import views

app_name = "task"

urlpatterns = [
    path("", views.index, name="index"),  # For displaying the index page
    path(
        "set_workspace/",
        views.set_workspace,
        name="set_workspace",
    ),  # For setting the selected workspace
    path("add_floor/", views.add_floor, name="add_floor"),
    path("remove_floor/<int:floor_id>/", views.remove_floor, name="remove_floor"),
    path("add_room/", views.add_room, name="add_room"),
    path("remove_room/<int:room_id>", views.remove_room, name="remove_room"),
    path("floor/<int:floor_id>", views.floor, name="floor"),
    path("room_view/<int:floor_id>", views.room_view, name="room_view"),
    path("tasks/create/", views.create_task, name="create_task"),
    path("fetch_tasks/", views.fetch_tasks, name="fetch_tasks"),
]
