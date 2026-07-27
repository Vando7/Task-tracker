import type { Member, Task, TaskCategory } from '@task-tracker/shared'
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
import { Icon, type IconName } from './Icon'
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
 *
 * The controls are icon buttons with `aria-label`s, so a card stays legible at
 * phone width without truncating the thing that actually matters — the name.
 */

/** Keyed by the enum, not by `string`, so every category is covered exhaustively. */
const CATEGORY_META: Record<
  TaskCategory,
  { icon: IconName; label: string; chip: string; edge: string }
> = {
  urgent: {
    icon: 'flame',
    label: 'Urgent',
    chip: 'text-urgent bg-urgent/15',
    edge: 'border-l-urgent',
  },
  special: {
    icon: 'star',
    label: 'Special',
    chip: 'text-special bg-special/15',
    edge: 'border-l-special',
  },
  normal: {
    icon: 'check',
    label: 'Normal',
    chip: 'text-text-dim bg-ink-hover',
    edge: 'border-l-edge-strong',
  },
}

export function TaskCard({
  task,
  workspaceId,
  members,
  flashing,
  claimUserId,
}: {
  task: Task
  workspaceId: string
  members: Member[]
  flashing?: boolean
  /**
   * When set, an unassigned task offers a one-tap "I'll do it" for this user.
   * Used by the dashboard's up-for-grabs list. Unassigned is still a valid
   * resting state (section 4.1) — this is an offer, not a demand.
   */
  claimUserId?: string
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
  const category = CATEGORY_META[task.category]
  const canClaim = Boolean(claimUserId) && !done && task.assignees.length === 0

  // A floor colour for the card, taken from its first room. A task with no rooms
  // falls back to the theme default, which is a normal state.
  const floorColor = task.rooms[0]?.floorColor

  return (
    <article
      className={[
        'card hover-lift border-l-4 p-3',
        category.edge,
        done ? 'opacity-75' : '',
        flashing ? 'flash' : '',
      ].join(' ')}
      style={floorColor ? ({ '--floor': floorColor } as React.CSSProperties) : undefined}
    >
      <div className="flex items-start gap-2.5">
        {!done ? (
          <button
            type="button"
            onClick={() => complete.mutate({ taskId: task.id })}
            disabled={complete.isPending}
            aria-label={`Mark "${task.name}" done`}
            title="Mark done"
            className="tap flex size-11 shrink-0 items-center justify-center rounded-xl border border-done/40 text-done transition-colors hover:bg-done/15 disabled:opacity-50 sm:size-10"
          >
            <Icon name="check" size={20} strokeWidth={2.25} />
          </button>
        ) : task.isRecurring ? (
          <button
            type="button"
            onClick={() => reopen.mutate(task.id)}
            aria-label={`Move "${task.name}" back to to-do`}
            title="Back to to-do"
            className="tap flex size-11 shrink-0 items-center justify-center rounded-xl border border-edge text-text-dim transition-colors hover:bg-ink-hover hover:text-text sm:size-10"
          >
            <Icon name="undo" size={19} />
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-done/12 text-done sm:size-10"
          >
            <Icon name="checkCircle" size={19} />
          </span>
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

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {task.dueDate && (
              <span
                className={
                  task.isOverdue
                    ? 'chip bg-urgent/15 font-medium text-urgent'
                    : 'chip text-text-dim'
                }
              >
                <Icon name={task.isOverdue ? 'alert' : 'clock'} size={13} />
                {task.isOverdue ? 'overdue · ' : 'due '}
                {relativeTime(task.dueDate)}
              </span>
            )}

            {task.category !== 'normal' && (
              <span className={`chip ${category.chip}`}>
                <Icon name={category.icon} size={13} />
                {category.label}
              </span>
            )}

            {task.isRecurring && (
              <span
                className="chip"
                title={
                  task.recurrenceAnchor === 'completion'
                    ? 'Next due date measured from when it is actually done'
                    : 'Next due date measured from the previous due date'
                }
              >
                <Icon name="repeat" size={13} />
                {recurrenceLabel(task.recurrenceEvery, task.recurrenceUnit)}
              </span>
            )}

            {task.rotateAssignees && (
              <span className="chip" title="Passed to the next person on completion">
                <Icon name="swap" size={13} />
                rotates
              </span>
            )}

            {/* From the completion log — far more useful than "modified 3 days ago". */}
            {task.completionCount > 0 && (
              <span className="chip bg-transparent">
                <Icon name="checkCircle" size={13} />
                {lastDoneLabel(task.lastCompletedAt)}
              </span>
            )}

            {task.rooms.map((room) => (
              <span
                key={room.id}
                className="chip"
                style={{
                  background: `color-mix(in oklab, ${room.floorColor} 18%, transparent)`,
                  color: 'var(--color-text)',
                }}
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
                    <Icon name="x" size={12} strokeWidth={2.25} />
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <AssigneeStack users={task.assignees.map((assignee) => assignee.user)} />

          {canClaim && claimUserId && (
            <button
              type="button"
              onClick={() => assign.mutate({ taskId: task.id, userId: claimUserId })}
              disabled={assign.isPending}
              className="btn btn-sm mt-0.5"
              title="Assign this to yourself"
              aria-label={`Assign "${task.name}" to me`}
            >
              <Icon name="userPlus" size={14} />
              {/* Icon-only on a phone: the label costs width the task name needs more. */}
              <span className="hidden sm:inline">I'll do it</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="icon-btn icon-btn-ghost mt-auto"
            aria-label={expanded ? `Collapse "${task.name}"` : `Expand "${task.name}"`}
          >
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={18} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-edge pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-text-dim">
              <span className="flex items-center gap-1.5">
                <Icon name="filter" size={13} />
                Category
              </span>
              <select
                value={task.category}
                onChange={(event) =>
                  update.mutate({
                    taskId: task.id,
                    category: event.target.value as Task['category'],
                  })
                }
                className="field mt-1 text-sm"
              >
                <option value="urgent">Urgent</option>
                <option value="special">Special</option>
                <option value="normal">Normal</option>
              </select>
            </label>

            <label className="text-xs text-text-dim">
              <span className="flex items-center gap-1.5">
                <Icon name="calendar" size={13} />
                Deadline
              </span>
              <span className="mt-1 flex gap-1">
                <input
                  type="datetime-local"
                  value={formatDateTimeLocal(task.dueDate)}
                  onChange={(event) =>
                    update.mutate({ taskId: task.id, dueDate: localInputToIso(event.target.value) })
                  }
                  className="field text-sm"
                />
                {task.dueDate && (
                  <button
                    type="button"
                    onClick={() => update.mutate({ taskId: task.id, dueDate: null })}
                    aria-label="Clear deadline"
                    title="Clear deadline"
                    className="icon-btn"
                  >
                    <Icon name="eraser" size={16} />
                  </button>
                )}
              </span>
            </label>
          </div>

          <fieldset>
            <legend className="flex items-center gap-1.5 text-xs text-text-dim">
              <Icon name="users" size={13} />
              Assignees
            </legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                      'flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors',
                      isAssigned
                        ? 'border-accent/40 bg-accent/15 text-text'
                        : 'border-edge text-text-dim hover:bg-ink-hover hover:text-text',
                    ].join(' ')}
                  >
                    <Avatar user={member.user} size={22} />
                    {member.user.name}
                    {isAssigned && <Icon name="check" size={13} className="text-accent-soft" />}
                  </button>
                )
              })}
            </div>
            {task.assignees.length === 0 && (
              <p className="mt-1.5 text-xs text-text-dim">
                Nobody in particular — whoever gets to it.
              </p>
            )}
          </fieldset>

          <div className="flex items-center justify-between gap-2">
            <span className="chip bg-transparent">
              <Icon name="chart" size={13} />
              {task.completionCount} completion{task.completionCount === 1 ? '' : 's'} logged
            </span>

            {/* A real two-step control, not a native confirm() dialog (gap 39). */}
            {confirmingDelete ? (
              <span className="flex items-center gap-1.5 text-xs">
                <span className="text-text-dim">Delete this task?</span>
                <button
                  type="button"
                  onClick={() => remove.mutate(task.id)}
                  className="btn btn-sm btn-danger"
                >
                  <Icon name="trash" size={14} />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="btn btn-sm"
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                aria-label={`Delete "${task.name}"`}
                className="btn btn-sm btn-quiet-danger"
              >
                <Icon name="trash" size={14} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  )
}
