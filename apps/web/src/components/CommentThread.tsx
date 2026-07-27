import {
  COMMENT_REACTIONS,
  type Comment,
  type CommentReactionEmoji,
  LIMITS,
} from '@task-tracker/shared'
import { useState } from 'react'
import {
  useAddComment,
  useComments,
  useDeleteComment,
  useToggleReaction,
} from '../features/comments/api'
import { useMe } from '../features/session/api'
import { relativeTime } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

/**
 * The notes on one task.
 *
 * This exists so that "the kettle was properly furred up, maybe make this monthly"
 * has somewhere to live other than the description. A description is a standing
 * definition of the chore; a note is one occasion, and putting the second in the
 * first means the next person to tidy up the wording destroys it.
 *
 * Oldest first, newest by the composer — a thread reads as a conversation, unlike
 * every other list in the app.
 */
export function CommentThread({ taskId, workspaceId }: { taskId: string; workspaceId: string }) {
  // Read here rather than threaded down from the page: `me` is already in the
  // query cache, so this costs nothing and keeps `TaskCard` uninvolved.
  const { data: me } = useMe()
  // Mounted only by an open card, so this is the fetch trigger.
  const { data, isPending } = useComments(taskId, true)
  const add = useAddComment(workspaceId, taskId)

  const [draft, setDraft] = useState('')

  const submit = (): void => {
    const body = draft.trim()
    if (body.length === 0 || add.isPending) return
    add.mutate(body, { onSuccess: () => setDraft('') })
  }

  return (
    <section aria-label="Notes">
      <h3 className="flex items-center gap-1.5 text-xs text-text-dim">
        <Icon name="comment" size={13} />
        Notes
        {data && data.total > 0 && <span>· {data.total}</span>}
      </h3>

      {isPending ? (
        <p className="mt-1.5 text-xs text-text-dim">Loading…</p>
      ) : data && data.comments.length > 0 ? (
        <ol className="mt-2 space-y-2.5">
          {data.comments.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              taskId={taskId}
              workspaceId={workspaceId}
              currentUserId={me?.user.id ?? ''}
            />
          ))}
        </ol>
      ) : (
        <p className="mt-1.5 text-xs text-text-dim">
          Nothing yet. Notes are for what happened this time — the description is for what the chore
          is.
        </p>
      )}

      <div className="mt-2.5 flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          // Enter inserts a newline, as it must on a phone keyboard; the shortcut
          // is for whoever is typing on a laptop.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
          }}
          rows={1}
          maxLength={LIMITS.commentBody}
          placeholder="Add a note…"
          aria-label="Add a note"
          className="field min-h-11 flex-1 py-2.5 text-sm"
        />
        <button
          type="button"
          onClick={submit}
          disabled={draft.trim().length === 0 || add.isPending}
          aria-label="Post note"
          title="Post note (⌘/Ctrl + Enter)"
          className="icon-btn icon-btn-primary tap"
        >
          <Icon name="send" size={17} />
        </button>
      </div>

      {add.error && (
        <p role="alert" className="mt-1.5 text-xs text-urgent">
          {add.error instanceof Error ? add.error.message : 'Could not post that note'}
        </p>
      )}
    </section>
  )
}

function CommentRow({
  comment,
  taskId,
  workspaceId,
  currentUserId,
}: {
  comment: Comment
  taskId: string
  workspaceId: string
  currentUserId: string
}) {
  const remove = useDeleteComment(workspaceId, taskId)
  const react = useToggleReaction(taskId, currentUserId)

  const [confirming, setConfirming] = useState(false)
  const [picking, setPicking] = useState(false)

  const used = new Set(comment.reactions.map((group) => group.emoji))
  const unused = COMMENT_REACTIONS.filter((emoji) => !used.has(emoji))

  return (
    <li className="rounded-xl bg-ink px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs text-text-dim">
        {/* Null author is normal: the note outlives the account that wrote it. */}
        {comment.author ? (
          <Avatar user={comment.author} size={20} />
        ) : (
          <span aria-hidden="true" className="flex size-5 items-center justify-center">
            <Icon name="user" size={13} />
          </span>
        )}
        <span className="font-medium text-text">
          {comment.author?.name ?? 'Someone since gone'}
        </span>
        <span>·</span>
        <time dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}</time>

        {comment.canDelete && (
          <span className="ml-auto">
            {confirming ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => remove.mutate(comment.id)}
                  className="btn btn-sm btn-danger"
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className="btn btn-sm">
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Delete this note"
                className="icon-btn icon-btn-ghost"
              >
                <Icon name="trash" size={14} />
              </button>
            )}
          </span>
        )}
      </div>

      {/* `whitespace-pre-line`, so a note typed as two lines stays two lines. */}
      <p className="mt-1 whitespace-pre-line text-sm">{comment.body}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {comment.reactions.map((group) => (
          <button
            key={group.emoji}
            type="button"
            aria-pressed={group.mine}
            onClick={() => react.mutate({ commentId: comment.id, emoji: group.emoji })}
            // Who reacted, not just how many — the row exists to be read.
            title={
              group.users.length > 0
                ? group.users.map((user) => user.name).join(', ')
                : `${group.count} reacted`
            }
            className={[
              'flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors',
              group.mine
                ? 'border-accent/40 bg-accent/15 text-text'
                : 'border-edge text-text-dim hover:bg-ink-hover hover:text-text',
            ].join(' ')}
          >
            <span aria-hidden="true">{group.emoji}</span>
            <span className="tabular-nums">{group.count}</span>
          </button>
        ))}

        {unused.length > 0 &&
          (picking ? (
            <span className="flex flex-wrap items-center gap-0.5">
              {unused.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    react.mutate({ commentId: comment.id, emoji: emoji as CommentReactionEmoji })
                    setPicking(false)
                  }}
                  aria-label={`React with ${emoji}`}
                  className="tap flex size-11 items-center justify-center rounded-full hover:bg-ink-hover sm:size-9"
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPicking(false)}
                aria-label="Close reactions"
                className="icon-btn icon-btn-ghost"
              >
                <Icon name="x" size={14} />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setPicking(true)}
              aria-label="Add a reaction"
              title="Add a reaction"
              className="icon-btn icon-btn-ghost"
            >
              <Icon name="reaction" size={15} />
            </button>
          ))}
      </div>
    </li>
  )
}
