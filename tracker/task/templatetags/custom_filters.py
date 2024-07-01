from django import template

register = template.Library()


@register.filter
def count_not_done(tasks):
    return tasks.exclude(status="done").count()
