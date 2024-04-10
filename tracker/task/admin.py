from django.contrib import admin
from .models import Task, Workspace, Floor, Room

class TaskAdmin(admin.ModelAdmin):
    list_display = [field.name for field in Task._meta.fields]

class WorkspaceAdmin(admin.ModelAdmin):
    list_display = [field.name for field in Workspace._meta.fields]

class FloorAdmin(admin.ModelAdmin):
    list_display = [field.name for field in Floor._meta.fields]

class RoomAdmin(admin.ModelAdmin):
    list_display = [field.name for field in Room._meta.fields]

admin.site.register(Task, TaskAdmin)
admin.site.register(Workspace, WorkspaceAdmin)
admin.site.register(Floor, FloorAdmin)
admin.site.register(Room, RoomAdmin)