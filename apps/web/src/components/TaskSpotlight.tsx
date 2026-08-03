import type { Member } from '@task-tracker/shared'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMe } from '../features/session/api'
import { useTask } from '../features/tasks/api'
import { ApiRequestError } from '../lib/api'
import { taskPath } from '../lib/share'
import { Icon } from './Icon'
import { TaskCard } from './TaskCard'

/**
 * The task a link pointed at, pinned above the list.
 *
 * `?task=` used to mean nothing more than "open that card if it happens to be on
 * screen", which is why a notification tap so often did nothing you could see: the
 * task might be filtered out, might be `done` while you are looking at pending, or
 * might simply be past the list's limit. The card was never there to expand.
 *
 * So the linked task is fetched *by id* and rendered here instead — above the list,
 * marked, expanded, scrolled to. Three consequences worth keeping:
 *
 * - It cannot miss. Filters, status and paging no longer decide whether a link
 *   works.
 * - The page still says where you are. This is not a detail route: the list is
 *   underneath, so "what else needs doing" is one scroll away, which is the whole
 *   reason the app is a list of cards and not a stack of pages.
 * - The state is escapable and explained. A band says why the card is up here and
 *   the dismiss clears `?task=`, so nobody is left with a highlighted card and no
 *   idea what put it there.
 */
export function TaskSpotlight({
  workspaceId,
  members,
}: {
  workspaceId: string
  members: Member[]
}) {
  const [params, setParams] = useSearchParams()
  const taskId = params.get('task') ?? undefined

  const { data: task, isPending, error } = useTask(taskId)
  // A cache read — every page rendering a card already has it.
  const { data: me } = useMe()
  const ref = useRef<HTMLDivElement>(null)

  /**
   * Scroll once the card exists, keyed on the id alone so that following a second
   * link while already here scrolls again but an edit to the task does not. On the
   * tasks page this is usually a no-op, since the spotlight is near the top — it
   * earns its keep when the browser restores a scroll position from a previous
   * visit to the same URL.
   */
  const landedOn = task?.id
  useEffect(() => {
    if (!landedOn) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ref.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }, [landedOn])

  const dismiss = (): void => {
    const next = new URLSearchParams(params)
    next.delete('task')
    setParams(next, { replace: true })
  }

  if (!taskId) return null

  // A 404 is the ordinary outcome for a link to a deleted task, and for one from a
  // household this account is no longer in — out-of-workspace reads answer 404 on
  // purpose, so there is nothing here to distinguish and nothing worth guessing at.
  const gone = error instanceof ApiRequestError && error.status === 404

  /**
   * A task from a household this account *is* in, but not the one in the path.
   * `GET /api/tasks/:id` authorizes against the task's own workspace, so a member
   * of two households can hand-edit or half-paste a URL into this state — and then
   * a card from the wrong house would render over the right one's list. Send them to
   * the URL that works instead of rendering a lie.
   */
  const elsewhere = task && task.workspaceId !== workspaceId ? task : undefined

  return (
    // `scroll-mt-19` clears the 60px sticky header. Without it `scrollIntoView`
    // aligns this section's top with the viewport's and the header covers the band
    // and the task's own name — the two things the scroll was for.
    <section ref={ref} aria-label="Linked task" className="mt-5 scroll-mt-19">
      <div className="flex items-center gap-1.5 pb-1.5 pl-1 text-xs text-text-dim">
        <Icon name="link" size={13} />
        <span>{gone ? 'This link has gone stale' : 'Linked task'}</span>
        <button
          type="button"
          onClick={dismiss}
          className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-ink-hover hover:text-text"
        >
          <Icon name="x" size={13} strokeWidth={2.25} />
          Unpin
        </button>
      </div>

      {isPending && <div className="h-24 animate-shimmer rounded-2xl bg-ink-raised" />}

      {gone && (
        <p className="card-quiet p-4 text-sm text-text-dim">
          That task is not here. It may have been deleted, or the link may belong to a different
          household.
        </p>
      )}

      {error && !gone && (
        <p className="card-quiet p-4 text-sm text-text-dim">
          That task could not be loaded just now.
        </p>
      )}

      {elsewhere && (
        <p className="card-quiet p-4 text-sm text-text-dim">
          “{elsewhere.name}” belongs to another household you are in.{' '}
          <Link
            to={taskPath(elsewhere.workspaceId, elsewhere.id)}
            className="text-accent-soft hover:underline"
          >
            Open it there
          </Link>
          .
        </p>
      )}

      {task && !elsewhere && (
        <TaskCard
          // Remount on a new id, so following a second link opens the new card
          // rather than reusing the first one's expanded state.
          key={task.id}
          task={task}
          workspaceId={workspaceId}
          members={members}
          claimUserId={me?.user.id}
          defaultExpanded
          spotlit
        />
      )}
    </section>
  )
}
