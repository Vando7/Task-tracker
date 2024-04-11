from django.db import models


class Workspace(models.Model):
    name = models.CharField(max_length=100)
    users = models.ManyToManyField("users.User", related_name="workspaces")
    created_by = models.ForeignKey("users.User", on_delete=models.CASCADE, null=True)

    class Meta:
        app_label = "task"

    def __str__(self):
        return self.name


class Floor(models.Model):
    name = models.CharField(max_length=100)
    workspace = models.ForeignKey(
        Workspace, related_name="floors", on_delete=models.CASCADE
    )

    class Meta:
        app_label = "task"

    def __str__(self):
        return self.name


class Room(models.Model):
    name = models.CharField(max_length=100)
    floor = models.ForeignKey(Floor, related_name="rooms", on_delete=models.CASCADE)

    class Meta:
        app_label = "task"

    def __str__(self):
        return self.name


class Task(models.Model):
    STATUS_CHOICES = [
        ("to_do", "To Do"),
        ("updated", "Updated"),
        ("overdue", "Overdue"),
        ("done", "Done"),
    ]

    TYPE_CHOICES = [
        ("single", "Single"),
        ("recurring", "Recurring"),
    ]

    CATEGORY_CHOICES = [
        ("urgent", "Urgent"),
        ("normal", "normal"),
        ("special", "special"),
    ]

    task_name = models.CharField(max_length=128)
    task_description = models.CharField(max_length=512, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="to_do")
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default="single")
    category = models.CharField(
        max_length=10, choices=CATEGORY_CHOICES, default="normal"
    )
    due_date = models.DateTimeField(blank=True, null=True)
    creation_date = models.DateTimeField(auto_now_add=True)
    modified_date = models.DateTimeField(blank=True, null=True)
    completed_date = models.DateTimeField(blank=True, null=True)
    rooms = models.ManyToManyField(Room, related_name="tasks")

    class Meta:
        app_label = "task"

    def __str__(self):
        return self.task_name
