import { useQueryClient } from '@tanstack/react-query'
import type { SseEvent, Task } from '@task-tracker/shared'
import { useEffect, useRef } from 'react'
import { keys } from './keys'

/**
 * One hook, replacing the entire legacy reconciliation engine.
 *
 * The legacy client polled `max(modified_date)` every 10 seconds, refetched both
 * full lists when it moved, then hand-diffed the DOM card by card against
 * timestamps stashed in hidden `display:none` spans — about 1300 lines, and the
 * single biggest reason that frontend resisted change.
 *
 * Here each event carries the changed entity, so it is written straight into the
 * query cache by id. There is nothing to diff.
 */

type Options = {
  workspaceId: string | undefined
  /** The signed-in user's id, so we can ignore the echo of our own writes. */
  currentUserId: string | undefined
  onFlash?: (taskId: string) => void
}

export function useEventStream({ workspaceId, currentUserId, onFlash }: Options): void {
  const queryClient = useQueryClient()
  const flashRef = useRef(onFlash)
  flashRef.current = onFlash

  useEffect(() => {
    if (!workspaceId) return

    const source = new EventSource(`/api/events?workspaceId=${encodeURIComponent(workspaceId)}`)

    const applyTask = (task: Task): void => {
      queryClient.setQueryData(keys.task(task.id), task)
      // The list queries are keyed by filter, so rather than guess which ones
      // this task belongs to, invalidate the family and let TanStack refetch the
      // views that are actually mounted.
      void queryClient.invalidateQueries({ queryKey: keys.taskList(workspaceId) })
      // Someone else's completion moves the dashboard's tally and room staleness.
      void queryClient.invalidateQueries({ queryKey: keys.staleness(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: keys.fairnessAll(workspaceId) })
      flashRef.current?.(task.id)
    }

    source.onmessage = (message: MessageEvent<string>) => {
      let event: SseEvent
      try {
        event = JSON.parse(message.data) as SseEvent
      } catch {
        return
      }

      // Our own change already landed optimistically; re-applying it would make
      // the card flicker.
      if (event.actorId && event.actorId === currentUserId) {
        if (event.type === 'notification') {
          // ...except notifications, which are addressed to us on purpose.
        } else {
          return
        }
      }

      switch (event.type) {
        case 'task.created':
        case 'task.updated':
        case 'task.assigned':
        case 'task.unassigned':
          applyTask(event.data)
          break

        case 'task.deleted':
          queryClient.removeQueries({ queryKey: keys.task(event.data.id) })
          void queryClient.invalidateQueries({ queryKey: keys.taskList(workspaceId) })
          break

        // Comment events carry ids, not the comment: `canDelete` and `mine` are
        // per-viewer answers and this payload is shared by the whole workspace.
        // So refetch the thread instead of writing it — cheap, because only an
        // open card has one. The task list goes too, for the count on the card.
        case 'comment.created':
        case 'comment.updated':
        case 'comment.deleted':
          void queryClient.invalidateQueries({ queryKey: keys.comments(event.data.taskId) })
          void queryClient.invalidateQueries({ queryKey: keys.taskList(workspaceId) })
          break

        case 'floor.created':
        case 'floor.updated':
        case 'floor.deleted':
        case 'room.created':
        case 'room.updated':
        case 'room.deleted':
          void queryClient.invalidateQueries({ queryKey: keys.layout(workspaceId) })
          break

        case 'member.added':
        case 'member.removed':
          void queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) })
          break

        case 'notification':
          void queryClient.invalidateQueries({ queryKey: keys.notifications() })
          break
      }
    }

    // `EventSource` reconnects on its own. All we have to do is close the gap
    // for whatever happened while we were away.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) return
      void queryClient.invalidateQueries({ queryKey: keys.workspace(workspaceId) })
    }

    return () => source.close()
  }, [workspaceId, currentUserId, queryClient])
}
