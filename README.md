# Task Tracker

Track house tasks easily

Task Tracker is a powerful application designed to help you efficiently manage and keep track of household tasks. Inspired by the need to organize multiple tasks and avoid forgetting important chores, this app provides a convenient solution for viewing and managing tasks across different rooms and floors of your home. With Task Tracker, you can quickly see what needs to be done in each area, ensuring that no task is overlooked.

## Key Features

- **Dynamic Task Management**: Tasks update in real-time without the need for a page refresh. When one user adds or edits a task, all other users in the workspace will see the updates instantly.
- **User Collaboration**: Create workspaces, add multiple users, and collaborate seamlessly. Each user can see and manage tasks assigned to them or shared within the workspace.
- **Room and Floor Organization**: Easily categorize tasks by creating rooms and floors, providing a clear and organized view of your household tasks.

## Tech Stack

- **Backend**: Django
- **Frontend**: Bootstrap
- **Database**: PostgreSQL
- **Real-time Updates**: Implemented using Django Channels

Task Tracker is an excellent portfolio project, showcasing your ability to build a full-stack application with real-time capabilities, user authentication, and collaborative features.


[![Built with Cookiecutter Django](https://img.shields.io/badge/built%20with-Cookiecutter%20Django-ff69b4.svg?logo=cookiecutter)](https://github.com/cookiecutter/cookiecutter-django/)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

License: MIT


## Basic Commands

### Setting Up Your Users

- To create a **normal user account**, just go to Sign Up and fill out the form. Once you submit it, you'll see a "Verify Your E-mail Address" page. Go to your console to see a simulated email verification message. Copy the link into your browser. Now the user's email should be verified and ready to go.

- To create a **superuser account**, use this command:

      $ python manage.py createsuperuser

For convenience, you can keep your normal user logged in on Chrome and your superuser logged in on Firefox (or similar), so that you can see how the site behaves for both kinds of users.

### Email Server

In development, it is often nice to be able to see emails that are being sent from your application. For that reason local SMTP server [Mailpit](https://github.com/axllent/mailpit) with a web interface is available as docker container.

Container mailpit will start automatically when you will run all docker containers.
Please check [cookiecutter-django Docker documentation](http://cookiecutter-django.readthedocs.io/en/latest/deployment-with-docker.html) for more details how to start all containers.

With Mailpit running, to view messages that are sent by your application, open your browser and go to `http://127.0.0.1:8025`

## Deployment


### Docker

To run the dev environment:

    $ ./run_container_dev.sh

On first run, it will take a while to download all the dependencies.
Afterwards, you'll need to enter the web server container and run migrations:

    $ docker exec -it task_tracked_web_1 bash
    $ python manage.py migrate
