# Generated by Django 4.2.11 on 2024-05-20 21:18

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('task', '0008_floor_color'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='deleted_date',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]