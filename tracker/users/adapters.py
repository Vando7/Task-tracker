from __future__ import annotations

import typing

import requests
from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.core.files.base import ContentFile
from django.db.models import Prefetch

from tracker.task.models import Floor
from tracker.task.models import Room
from tracker.task.models import Workspace

if typing.TYPE_CHECKING:
    from allauth.socialaccount.models import SocialLogin
    from django.http import HttpRequest

    from tracker.users.models import User


class AccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request: HttpRequest) -> bool:
        return getattr(settings, "ACCOUNT_ALLOW_REGISTRATION", True)

    def login(self, request, user):
        super().login(request, user)

        # Create a default workspace for the user if they don't have one
        if not user.default_workspace:
            workspace = Workspace.objects.create(
                name=f"{user.email}'s Workspace",
                created_by=user,
            )
            workspace.users.add(user)
            user.default_workspace = workspace
            user.save()

        # Use google avatar if user has no avatar
        if not user.avatar and user.socialaccount_set.exists():
            social_account = user.socialaccount_set.first()
            if social_account.provider == "google":
                picture_url = social_account.extra_data.get("picture")
                if picture_url:
                    response = requests.get(picture_url, timeout=5)
                    if response.status_code == 200:
                        # You can change 'avatar.jpg' to include user.id or other unique identifiers
                        user.avatar.save(
                            f"{user.username}_avatar.jpg",
                            ContentFile(response.content),
                            save=True,
                        )

        request.session["selected_workspace_id"] = user.default_workspace.id

        # load the sidebar floor list
        floors_prefetch = Prefetch("floors__rooms", queryset=Room.objects.all())

        all_workspaces = Workspace.objects.filter(users=user).prefetch_related(
            floors_prefetch,
        )

        workspace = all_workspaces.get(id=user.default_workspace.id)
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
                    }
                    for room in rooms
                    if room.floor == floor
                ],
            }
            for floor in floors
        ]

        request.session["sidebar_floors"] = sidebar_floors


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def is_open_for_signup(
        self,
        request: HttpRequest,
        sociallogin: SocialLogin,
    ) -> bool:
        return getattr(settings, "ACCOUNT_ALLOW_REGISTRATION", True)

    def populate_user(
        self,
        request: HttpRequest,
        sociallogin: SocialLogin,
        data: dict[str, typing.Any],
    ) -> User:
        """
        Populates user information from social provider info.

        See: https://docs.allauth.org/en/latest/socialaccount/advanced.html#creating-and-populating-user-instances
        """
        user = super().populate_user(request, sociallogin, data)
        if not user.name:
            if name := data.get("name"):
                user.name = name
            elif first_name := data.get("first_name"):
                user.name = first_name
                if last_name := data.get("last_name"):
                    user.name += f" {last_name}"
        return user
