/**
 * Query keys in one place.
 *
 * Hierarchical on purpose: `taskList(workspaceId)` is a prefix of every filtered
 * list, so the SSE hook can invalidate all of them without knowing which filters
 * happen to be mounted.
 */
export const keys = {
  me: () => ['me'] as const,
  workspace: (workspaceId: string) => ['workspace', workspaceId] as const,
  layout: (workspaceId: string) => ['workspace', workspaceId, 'layout'] as const,
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
  /** A prefix of every window, so a completion can invalidate them all. */
  fairnessAll: (workspaceId: string) => ['workspace', workspaceId, 'fairness'] as const,
  fairness: (workspaceId: string, window: string) =>
    ['workspace', workspaceId, 'fairness', window] as const,
  staleness: (workspaceId: string) => ['workspace', workspaceId, 'staleness'] as const,
  taskList: (workspaceId: string) => ['workspace', workspaceId, 'tasks'] as const,
  tasks: (workspaceId: string, filters: Record<string, unknown>) =>
    ['workspace', workspaceId, 'tasks', filters] as const,
  task: (taskId: string) => ['task', taskId] as const,
  /** Nested under the task, so removing a task drops its thread with it. */
  comments: (taskId: string) => ['task', taskId, 'comments'] as const,
  notifications: () => ['notifications'] as const,
  notifyPreferences: () => ['notifications', 'preferences'] as const,
  vapidKey: () => ['notifications', 'vapid'] as const,
}
