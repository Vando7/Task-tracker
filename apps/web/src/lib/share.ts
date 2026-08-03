/**
 * One task, one URL.
 *
 * `taskPath` is the single definition of where a link to a task points, and
 * everything that can send someone to a task goes through it: the share button on
 * a card, the notification feed in the header, and — by agreement rather than by
 * import, since it is built on the server — the push payload in
 * `services/notifications.ts`. If that shape ever changes, both have to move.
 *
 * The URL is deliberately *canonical* rather than contextual: it never carries the
 * filters the sharer happened to have on, and it never depends on which page they
 * shared from. A recipient of "have a look at this" should land on the task, in
 * the full list, not inside someone else's search for "kettle".
 */
export const taskPath = (workspaceId: string, taskId: string): string =>
  `/w/${workspaceId}/tasks?task=${encodeURIComponent(taskId)}`

export const taskUrl = (workspaceId: string, taskId: string): string =>
  new URL(taskPath(workspaceId, taskId), window.location.origin).toString()

/**
 * What actually happened, because the button has to say something different for
 * each and there is no way to know in advance which path a device will take.
 *
 * - `shared` — the OS share sheet took it. It is its own confirmation, so the
 *   button says nothing.
 * - `copied` — on the clipboard. Needs a confirmation, since nothing visible moved.
 * - `manual` — neither was available, so the caller has to *show* the URL and let
 *   the user copy it by hand.
 */
export type ShareOutcome = 'shared' | 'copied' | 'manual'

/**
 * Share a task, best available way first.
 *
 * `navigator.share` gives a phone the sheet its owner already knows — the chore
 * goes to the household group chat in two taps. Everything else copies.
 *
 * Both of those APIs require a secure context, and this app is routinely opened
 * over plain http on a LAN (`EXPOSE=1 pnpm dev`, and any deployment without TLS),
 * which is exactly the phone case where sharing matters most. So `manual` is a
 * real path, not a theoretical one, and the caller must handle it.
 */
export async function shareTask({
  workspaceId,
  taskId,
  taskName,
}: {
  workspaceId: string
  taskId: string
  taskName: string
}): Promise<ShareOutcome> {
  const url = taskUrl(workspaceId, taskId)

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: taskName, text: taskName, url })
      return 'shared'
    } catch (error) {
      // Dismissing the sheet is an `AbortError`, and it is not a failure — falling
      // through to the clipboard would silently do a thing the user just declined.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared'
    }
  }

  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'manual'
  }
}
