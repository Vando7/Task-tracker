import type { Member, Task } from '@task-tracker/shared'
import { useState } from 'react'
import {
  useAssignUser,
  useCompleteTask,
  useDeleteTask,
  useDetachRoom,
  useReopenTask,
  useUnassignUser,
  useUpdateTask,
} from '../features/tasks/api'
import {
  formatDateTimeLocal,
  lastDoneLabel,
  localInputToIso,
  recurrenceLabel,
  relativeTime,
} from '../lib/format'
import { AssigneeStack, Avatar } from './Avatar'
import { InlineText } from './InlineText'

/**
 * A task card.
 *
 * Every control saves immediately, as in the legacy app — no Save button, no
 * dirty state. What is different is that state lives in React keyed by task id,
 * not in hidden `display:none` spans that get diffed as strings
 * (Part 2, problem 19). And the edit affordances are real form controls rather
 * than `contenteditable`, which was never keyboard- or screen-reader-workable
 * (gap 39).
 */
export function TaskCard({
  task,
  workspaceId,
  members,
  flashing,
}: {
  task: Task
  workspaceId: string
  members: Member[]
  flashing?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const update = useUpdateTask(workspaceId)
  const complete = useCompleteTask(workspaceId)
  const reopen = useReopenTask(workspaceId)
  const remove = useDeleteTask(workspaceId)
  const assign = useAssignUser(workspaceId)
  const unassign = useUnassignUser(workspaceId)
  const detachRoom = useDetachRoom(workspaceId)

  const done = task.status === 'done'
  const assignedIds = new Set(task.assignees.map((assignee) => assignee.user.id))

  // A floor colour for the card, taken from its first room. A task with no rooms
  // falls back to the theme default, which is a normal state.
  const floorColor = task.rooms[0]?.floorColor

  const categoryStyles: Record<string, string> = {
    urgent: 'border-l-urgent',
    special: 'border-l-special',
    normal: 'border-l-edge',
  }

  return (
    <article
      className={[
        'rounded-xl border border-edge border-l-4 bg-ink-raised p-3 transition-colors',
        categoryStyles[task.category] ?? 'border-l-edge',
        done ? 'opacity-70' : '',
        flashing ? 'flash' : '',
      ].join(' ')}
      style={floorColor ? ({ '--floor': floorColor } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start gap-2">
        {!done && (
          <button
            type="button"
            onClick={() => complete.mutate({ taskId: task.id })}
            disabled={complete.isPending}
            aria-label={`Mark "${task.name}" done`}
            className="tap flex shrink-0 items-center justify-center rounded-lg border border-done/40 text-done hover:bg-done/10 disabled:opacity-50"
          >
            ✓
          </button>
        )}

        {done && task.isRecurring && (
          <button
            type="button"
            onClick={() => reopen.mutate(task.id)}
            aria-label={`Move "${task.name}" back to to-do`}
            className="tap flex shrink-0 items-center justify-center rounded-lg border border-edge text-text-dim hover:bg-ink-hover"
          >
            ↻
          </button>
        )}

        <div className="min-w-0 flex-1">
          <InlineText
            value={task.name}
            onSave={(name) => update.mutate({ taskId: task.id, name })}
            className={`font-medium ${done ? 'line-through decoration-text-dim' : ''}`}
            label="Task name"
            maxLength={128}
          />

          <InlineText
            value={task.description}
            onSave={(description) => update.mutate({ taskId: task.id, description })}
            className="mt-0.5 text-sm text-text-dim"
            label="Description"
            placeholder="Add a description"
            maxLength={512}
            multiline
          />

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {task.dueDate && (
              <span
                className={
                  task.isOverdue
                    ? 'rounded-full bg-urgent/15 px-2 py-0.5 font-medium text-urgent'
                    : 'rounded-full bg-ink-hover px-2 py-0.5 text-text-dim'
                }
              >
                {task.isOverdue ? 'overdue · ' : 'due '}
                {relativeTime(task.dueDate)}
              </span>
            )}

            {task.isRecurring && (
              <span
                className="rounded-full bg-ink-hover px-2 py-0.5 text-text-dim"
                title={
                  task.recurrenceAnchor === 'completion'
                    ? 'Next due date measured from when it is actually done'
                    : 'Next due date measured from the previous due date'
                }
              >
                ↻ {recurrenceLabel(task.recurrenceEvery, task.recurrenceUnit)}
              </span>
            )}

            {task.rotateAssignees && (
              <span className="rounded-full bg-ink-hover px-2 py-0.5 text-text-dim">↻ rotates</span>
            )}

            {/* From the completion log — far more useful than "modified 3 days ago". */}
            {task.completionCount > 0 && (
              <span className="text-text-dim">{lastDoneLabel(task.lastCompletedAt)}</span>
            )}

            {task.rooms.map((room) => (
              <span
                key={room.id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-text-dim"
                style={{ background: `color-mix(in oklab, ${room.floorColor} 18%, transparent)` }}
              >
                <span aria-hidden="true">{room.icon}</span>
                {room.name}
                {expanded && (
                  <button
                    type="button"
                    onClick={() => detachRoom.mutate({ taskId: task.id, roomId: room.id })}
                    aria-label={`Remove ${room.name} from this task`}
                    className="ml-0.5 text-text-dim hover:text-urgent"
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <AssigneeStack users={task.assignees.map((assignee) => assignee.user)} />
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="tap text-text-dim hover:text-text"
            aria-label={expanded ? 'Collapse task' : 'Expand task'}
          >
            {expanded ? '▴' : '▾'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-edge pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-text-dim">
              Category
              <select
                value={task.category}
                onChange={(event) =>
                  update.mutate({
                    taskId: task.id,
                    category: event.target.value as Task['category'],
                  })
                }
                className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-2 text-sm text-text"
              >
                <option value="urgent">Urgent</option>
                <option value="special">Special</option>
                <option value="normal">Normal</option>
              </select>
            </label>

            <label className="text-xs text-text-dim">
              Deadline
              <span className="mt-1 flex gap-1">
                <input
                  type="datetime-local"
                  value={formatDateTimeLocal(task.dueDate)}
                  onChange={(event) =>
                    update.mutate({ taskId: task.id, dueDate: localInputToIso(event.target.value) })
                  }
                  className="tap w-full rounded-lg border border-edge bg-ink px-2 text-sm text-text"
                />
                {task.dueDate && (
                  <button
                    type="button"
                    onClick={() => update.mutate({ taskId: task.id, dueDate: null })}
                    aria-label="Clear deadline"
                    className="tap rounded-lg border border-edge px-2 text-text-dim hover:bg-ink-hover"
                  >
                    ⌫
                  </button>
                )}
              </span>
            </label>
          </div>

          <fieldset>
            <legend className="text-xs text-text-dim">Assignees</legend>
            <div className="mt-1 flex flex-wrap gap-1">
              {members.map((member) => {
                const isAssigned = assignedIds.has(member.user.id)
                return (
                  <button
                    key={member.user.id}
                    type="button"
                    aria-pressed={isAssigned}
                    onClick={() =>
                      isAssigned
                        ? unassign.mutate({ taskId: task.id, userId: member.user.id })
                        : assign.mutate({ taskId: task.id, userId: member.user.id })
                    }
                    className={[
                      'tap flex items-center gap-1.5 rounded-full border px-2 text-sm',
                      isAssigned
                        ? 'border-transparent bg-ink-hover text-text'
                        : 'border-edge text-text-dim hover:bg-ink-hover',
                    ].join(' ')}
                  >
                    <Avatar user={member.user} size={20} />
                    {member.user.name}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-dim">
              {task.completionCount} completion{task.completionCount === 1 ? '' : 's'} logged
            </span>

            {/* A real two-step control, not a native confirm() dialog (gap 39). */}
            {confirmingDelete ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-text-dim">Delete this task?</span>
                <button
                  type="button"
                  onClick={() => remove.mutate(task.id)}
                  className="tap rounded-lg bg-urgent/20 px-3 text-urgent hover:bg-urgent/30"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="tap rounded-lg border border-edge px-3 text-text-dim"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="tap rounded-lg border border-edge px-3 text-xs text-text-dim hover:border-urgent/50 hover:text-urgent"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
