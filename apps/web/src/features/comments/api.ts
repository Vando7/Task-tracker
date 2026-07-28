import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Comment, CommentList, CommentReactionEmoji } from '@task-tracker/shared'
import { api } from '../../lib/api'
import { keys } from '../../lib/keys'

/**
 * The comment thread for one task.
 *
 * `enabled` is the whole reason `commentCount` rides along on the task instead of
 * the comments themselves. The thread is visible on every card now, open or not,
 * so the gate is no longer "is this card expanded" but "does this task have any
 * notes at all" — which the card already knows without asking. A list of thirty
 * tasks where four have notes makes four comment requests, not thirty.
 *
 * Because that gate lags a beat behind a write (the count lives on the task, which
 * refetches separately), the mutations below keep this cache correct themselves
 * rather than only invalidating it.
 */
export function useComments(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.comments(taskId),
    queryFn: () => api<CommentList>(`/api/tasks/${taskId}/comments`),
    enabled,
    staleTime: 60_000,
  })
}

/**
 * A new comment invalidates the thread *and* the task list: the card's count came
 * from the task payload, so leaving the list alone would show a stale number right
 * next to the comment that just appeared.
 */
function useThreadInvalidation(workspaceId: string, taskId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: keys.comments(taskId) })
    void queryClient.invalidateQueries({ queryKey: keys.taskList(workspaceId) })
  }
}

export function useAddComment(workspaceId: string, taskId: string) {
  const queryClient = useQueryClient()
  const invalidate = useThreadInvalidation(workspaceId, taskId)

  return useMutation({
    mutationFn: (body: string) =>
      api<Comment>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: { body } }),
    onSuccess: (comment) => {
      // Append, rather than only invalidating. On the *first* note of a task the
      // task's `commentCount` is still 0 until the list refetches, so the thread
      // query is still disabled — an invalidate alone marks it stale and refetches
      // nothing, leaving the note you just wrote invisible for a beat.
      queryClient.setQueryData<CommentList>(keys.comments(taskId), (current) =>
        current
          ? { comments: [...current.comments, comment], total: current.total + 1 }
          : { comments: [comment], total: 1 },
      )
      invalidate()
    },
  })
}

export function useDeleteComment(workspaceId: string, taskId: string) {
  const queryClient = useQueryClient()
  const invalidate = useThreadInvalidation(workspaceId, taskId)

  return useMutation({
    mutationFn: (commentId: string) =>
      api<void>(`/api/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: (_result, commentId) => {
      // The mirror of the append, and needed for the same reason from the other
      // side: deleting the only note takes `commentCount` to 0, which disables the
      // thread query, so a stale cache would keep rendering the note that is gone.
      dropFromThread(queryClient, taskId, commentId)
      invalidate()
    },
  })
}

/** Shared with the SSE handler, which prunes by id for the same reason. */
export function dropFromThread(
  queryClient: ReturnType<typeof useQueryClient>,
  taskId: string,
  commentId: string,
): void {
  queryClient.setQueryData<CommentList>(keys.comments(taskId), (current) =>
    current
      ? {
          comments: current.comments.filter((comment) => comment.id !== commentId),
          total: Math.max(0, current.total - 1),
        }
      : current,
  )
}

/**
 * Optimistic, because a reaction is a tap that must feel instant, and rolled back
 * on failure.
 *
 * The server owns the toggle, but flipping `mine` locally is safe: the same
 * `(comment, user, emoji)` key decides it there, so the optimistic answer and the
 * real one cannot disagree about anything except a network failure.
 */
export function useToggleReaction(taskId: string, currentUserId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: CommentReactionEmoji }) =>
      api<Comment>(`/api/comments/${commentId}/reactions`, { method: 'POST', body: { emoji } }),

    onMutate: async ({ commentId, emoji }) => {
      await queryClient.cancelQueries({ queryKey: keys.comments(taskId) })
      const previous = queryClient.getQueryData<CommentList>(keys.comments(taskId))
      if (!previous) return { previous }

      queryClient.setQueryData<CommentList>(keys.comments(taskId), {
        ...previous,
        comments: previous.comments.map((comment) =>
          comment.id === commentId ? toggleLocally(comment, emoji, currentUserId) : comment,
        ),
      })

      return { previous }
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(keys.comments(taskId), context.previous)
      }
    },

    onSuccess: (comment) => {
      queryClient.setQueryData<CommentList>(keys.comments(taskId), (current) =>
        current
          ? {
              ...current,
              comments: current.comments.map((existing) =>
                existing.id === comment.id ? comment : existing,
              ),
            }
          : current,
      )
    },
  })
}

/** Mirrors the server's toggle on the cached copy, dropping a group that empties. */
function toggleLocally(
  comment: Comment,
  emoji: CommentReactionEmoji,
  currentUserId: string,
): Comment {
  const existing = comment.reactions.find((group) => group.emoji === emoji)

  if (!existing) {
    return {
      ...comment,
      reactions: [
        ...comment.reactions,
        // The optimistic user carries only an id: the group is rendered from
        // `count` and `mine`, and the real payload arrives a moment later.
        { emoji, count: 1, users: [], mine: true },
      ],
    }
  }

  if (existing.mine) {
    return {
      ...comment,
      reactions: comment.reactions.flatMap((group) =>
        group.emoji === emoji
          ? group.count <= 1
            ? []
            : [
                {
                  ...group,
                  count: group.count - 1,
                  mine: false,
                  users: group.users.filter((user) => user.id !== currentUserId),
                },
              ]
          : [group],
      ),
    }
  }

  return {
    ...comment,
    reactions: comment.reactions.map((group) =>
      group.emoji === emoji ? { ...group, count: group.count + 1, mine: true } : group,
    ),
  }
}
