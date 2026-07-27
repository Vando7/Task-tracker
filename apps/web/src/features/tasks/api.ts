import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CreateTaskBody, Task, TaskList, UpdateTaskBody } from '@task-tracker/shared'
import { api, query } from '../../lib/api'
import { keys } from '../../lib/keys'

export type TaskFilters = {
  status?: 'todo' | 'done'
  roomId?: string
  floorId?: string
  search?: string
  assignee?: string
  limit?: number
  offset?: number
}

export function useTasks(workspaceId: string | undefined, filters: TaskFilters) {
  return useQuery({
    queryKey: keys.tasks(workspaceId ?? '', filters),
    queryFn: () => api<TaskList>(`/api/workspaces/${workspaceId}/tasks${query(filters)}`),
    enabled: Boolean(workspaceId),
    // SSE pushes changes, so nothing here needs a polling interval.
    staleTime: 60_000,
  })
}

/**
 * Every mutation below invalidates the workspace's task list family. The SSE
 * event tells *other* clients; this keeps our own cache honest if a write
 * changed more than the entity we sent (a rotation, a rescheduled recurrence).
 *
 * The completion-log stats go too: a completion moves the fairness tally and a
 * room's staleness, both of which the dashboard shows next to the task itself.
 */
function useTaskInvalidation(workspaceId: string) {
  const queryClient = useQueryClient()
  return (task?: Task) => {
    if (task) queryClient.setQueryData(keys.task(task.id), task)
    void queryClient.invalidateQueries({ queryKey: keys.taskList(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: keys.layout(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: keys.staleness(workspaceId) })
    void queryClient.invalidateQueries({ queryKey: keys.fairnessAll(workspaceId) })
  }
}

export function useCreateTask(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: (input: CreateTaskBody) =>
      api<Task>(`/api/workspaces/${workspaceId}/tasks`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

/**
 * Optimistic, with rollback.
 *
 * The legacy client wrote, waited 200ms on a `setTimeout`, and hoped the next
 * poll agreed (Part 2, problem 18). Here the cache updates immediately and is
 * restored on failure.
 */
export function useUpdateTask(workspaceId: string) {
  const queryClient = useQueryClient()
  const invalidate = useTaskInvalidation(workspaceId)

  return useMutation({
    mutationFn: ({ taskId, ...input }: UpdateTaskBody & { taskId: string }) =>
      api<Task>(`/api/tasks/${taskId}`, { method: 'PATCH', body: input }),

    // `dueDate` is pulled out of the spread rather than overridden after it: the
    // request body accepts a Date or an ISO string, but a cached `Task` always
    // holds the ISO string the server would have sent back. Normalising here
    // makes the optimistic value indistinguishable from the real response.
    onMutate: async ({ taskId, dueDate, ...rest }) => {
      await queryClient.cancelQueries({ queryKey: keys.task(taskId) })
      const previous = queryClient.getQueryData<Task>(keys.task(taskId))

      if (previous) {
        const patch: Partial<Task> = {
          ...rest,
          ...(dueDate !== undefined
            ? { dueDate: dueDate === null ? null : new Date(dueDate).toISOString() }
            : {}),
        }
        queryClient.setQueryData<Task>(keys.task(taskId), { ...previous, ...patch })
      }

      return { previous, taskId }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(keys.task(context.taskId), context.previous)
      }
    },

    onSuccess: invalidate,
  })
}

export function useCompleteTask(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ taskId, completedAt }: { taskId: string; completedAt?: string }) =>
      api<Task>(`/api/tasks/${taskId}/complete`, {
        method: 'POST',
        body: completedAt ? { completedAt } : {},
      }),
    onSuccess: invalidate,
  })
}

export function useReopenTask(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: (taskId: string) => api<Task>(`/api/tasks/${taskId}/reopen`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}

export function useDeleteTask(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: (taskId: string) => api<void>(`/api/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  })
}

export function useAssignUser(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) =>
      api<Task>(`/api/tasks/${taskId}/assignees`, { method: 'POST', body: { userId } }),
    onSuccess: invalidate,
  })
}

export function useUnassignUser(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ taskId, userId }: { taskId: string; userId: string }) =>
      api<Task>(`/api/tasks/${taskId}/assignees/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useAttachRoom(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ taskId, roomId }: { taskId: string; roomId: string }) =>
      api<Task>(`/api/tasks/${taskId}/rooms`, { method: 'POST', body: { roomId } }),
    onSuccess: invalidate,
  })
}

export function useDetachRoom(workspaceId: string) {
  const invalidate = useTaskInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ taskId, roomId }: { taskId: string; roomId: string }) =>
      api<Task>(`/api/tasks/${taskId}/rooms/${roomId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
