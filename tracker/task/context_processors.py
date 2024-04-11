def workspace_processor(request):
    if request.user.is_authenticated:
        workspaces = request.user.workspaces.all()
        return {"global_workspaces": workspaces}

    return {"no_workspaces": "No workspaces available."}
