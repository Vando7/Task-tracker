import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Comment, CommentList, CommentReactionEmoji } from '@task-tracker/shared'
import { api } from '../../lib/api'
import { keys } from '../../lib/keys'

/**
 * The comment thread for one task.
 *
 * Fetched only when a card is open — `enabled` is the whole reason `commentCount`
 * rides along on the task instead of the comments themselves. A collapsed card
 * renders its count from data it already has, and a list of thirty tasks makes
 * zero comment requests.
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
  const invalidate = useThreadInvalidation(workspaceId, taskId)
  return useMutation({
    mutationFn: (body: string) =>
      api<Comment>(`/api/tasks/${taskId}/comments`, { method: 'POST', body: { body } }),
    onSuccess: invalidate,
  })
}

export function useDeleteComment(workspaceId: string, taskId: string) {
  const invalidate = useThreadInvalidation(workspaceId, taskId)
  return useMutation({
    mutationFn: (commentId: string) =>
      api<void>(`/api/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
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
