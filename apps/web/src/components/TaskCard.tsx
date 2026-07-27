import type { Member, RecurrenceUnit, Task, TaskCategory } from '@task-tracker/shared'
import { useState } from 'react'
import { useLayout } from '../features/layout/api'
import {
  useAssignUser,
  useAttachRoom,
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
import { CommentThread } from './CommentThread'
import { Icon, type IconName } from './Icon'
import { InlineText } from './InlineText'

/**
 * A task card.
 *
 * Every control saves immediately, as in the legacy app — no Save button, no
 * dirty state. What is different is that state lives in React keyed by task id,
 * not in hidden `display:none` spans that get diffed as strings. And the edit
 * affordances are real form controls rather than `contenteditable`, which was
 * never keyboard- or screen-reader-workable.
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
  defaultExpanded = false,
}: {
  task: Task
  workspaceId: string
  members: Member[]
  flashing?: boolean
  /**
   * When set, an unassigned task offers a one-tap "I'll do it" for this user.
   * Used by the dashboard's up-for-grabs list. Unassigned is still a valid
   * resting state — this is an offer, not a demand.
   */
  claimUserId?: string
  /** Open on mount, for the card a notification deep-links to. */
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const update = useUpdateTask(workspaceId)
  const complete = useCompleteTask(workspaceId)
  const reopen = useReopenTask(workspaceId)
  const remove = useDeleteTask(workspaceId)
  const assign = useAssignUser(workspaceId)
  const unassign = useUnassignUser(workspaceId)
  const attachRoom = useAttachRoom(workspaceId)
  const detachRoom = useDetachRoom(workspaceId)
  // Already fetched by every page that renders a card, so this is a cache read.
  const { data: layout } = useLayout(workspaceId)

  const done = task.status === 'done'
  const assignedIds = new Set(task.assignees.map((assignee) => assignee.user.id))
  const attachedRoomIds = new Set(task.rooms.map((room) => room.id))
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

            {/* Rendered from the count on the task itself, so a collapsed card
                costs no request. Opens the card rather than being decoration. */}
            {task.commentCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="chip hover:text-text"
                aria-label={`${task.commentCount} note${
                  task.commentCount === 1 ? '' : 's'
                } on "${task.name}"`}
              >
                <Icon name="comment" size={13} />
                <span className="tabular-nums">{task.commentCount}</span>
              </button>
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

          {/*
            Rooms, which had no edit control at all: the attach endpoint and its
            hook both existed, and nothing on a card ever called them, so a room
            could be removed and never put back. Same floor-grouped picker as the
            new-task sheet, because it is the same choice.
          */}
          {(layout?.floors.length ?? 0) > 0 && (
            <fieldset>
              <legend className="flex items-center gap-1.5 text-xs text-text-dim">
                <Icon name="door" size={13} />
                Rooms
              </legend>
              <div className="mt-1.5 max-h-40 space-y-2 overflow-y-auto">
                {layout?.floors.map((floor) => (
                  <div key={floor.id} style={{ '--floor': floor.color } as React.CSSProperties}>
                    <p className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
                      <span aria-hidden="true" className="floor-dot inline-block" />
                      {floor.icon} {floor.name}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {floor.rooms.map((room) => {
                        const attached = attachedRoomIds.has(room.id)
                        return (
                          <button
                            key={room.id}
                            type="button"
                            aria-pressed={attached}
                            onClick={() =>
                              attached
                                ? detachRoom.mutate({ taskId: task.id, roomId: room.id })
                                : attachRoom.mutate({ taskId: task.id, roomId: room.id })
                            }
                            className={[
                              'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm transition-colors',
                              attached
                                ? 'floor-tint border-transparent text-text'
                                : 'border-edge text-text-dim hover:bg-ink-hover hover:text-text',
                            ].join(' ')}
                          >
                            <span aria-hidden="true">{room.icon}</span>
                            {room.name}
                            {attached && <Icon name="check" size={13} />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              {task.rooms.length === 0 && (
                <p className="mt-1.5 text-xs text-text-dim">
                  No room — a whole-flat chore belongs to the household.
                </p>
              )}
            </fieldset>
          )}

          {/*
            Recurrence, also previously uneditable after creation: `updateTaskSchema`
            has accepted these four fields all along. `every` and `unit` must move
            together — the schema rejects one without the other, since an interval
            with no unit is meaningless and a unit with no interval never fires.
          */}
          <fieldset>
            <legend className="flex items-center gap-1.5 text-xs text-text-dim">
              <Icon name="repeat" size={13} />
              Repeats
            </legend>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-xs text-text-dim">every</span>
              <input
                type="number"
                min={1}
                max={365}
                value={task.recurrenceEvery ?? ''}
                placeholder="—"
                aria-label="Repeat interval"
                onChange={(event) => {
                  const value = event.target.value.trim()
                  if (value === '') {
                    update.mutate({
                      taskId: task.id,
                      recurrenceEvery: null,
                      recurrenceUnit: null,
                    })
                    return
                  }
                  const every = Number(value)
                  if (!Number.isInteger(every) || every < 1 || every > 365) return
                  update.mutate({
                    taskId: task.id,
                    recurrenceEvery: every,
                    // Clearing it leaves no unit behind, so supply the default
                    // alongside the first interval.
                    recurrenceUnit: task.recurrenceUnit ?? 'week',
                  })
                }}
                className="field w-20 text-center"
              />
              <select
                value={task.recurrenceUnit ?? 'week'}
                disabled={!task.isRecurring}
                aria-label="Repeat unit"
                onChange={(event) =>
                  update.mutate({
                    taskId: task.id,
                    recurrenceEvery: task.recurrenceEvery,
                    recurrenceUnit: event.target.value as RecurrenceUnit,
                  })
                }
                className="field w-auto"
              >
                <option value="day">days</option>
                <option value="week">weeks</option>
                <option value="month">months</option>
              </select>
              {!task.isRecurring && <span className="text-xs text-text-dim">One-off.</span>}
            </div>

            {task.isRecurring && (
              <>
                <label className="mt-2 block text-xs text-text-dim">
                  Measured from
                  <select
                    value={task.recurrenceAnchor}
                    onChange={(event) =>
                      update.mutate({
                        taskId: task.id,
                        recurrenceAnchor: event.target.value as Task['recurrenceAnchor'],
                      })
                    }
                    className="field mt-1 text-sm"
                  >
                    <option value="completion">when it was actually done</option>
                    <option value="dueDate">the previous due date (fixed cadence)</option>
                  </select>
                </label>

                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={task.rotateAssignees}
                    onChange={(event) =>
                      update.mutate({ taskId: task.id, rotateAssignees: event.target.checked })
                    }
                    className="size-4 accent-accent"
                  />
                  <Icon name="swap" size={15} className="text-text-dim" />
                  Hand it to the next person each time
                </label>
              </>
            )}
          </fieldset>

          <div className="border-t border-edge pt-3">
            <CommentThread taskId={task.id} workspaceId={workspaceId} />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="chip bg-transparent">
              <Icon name="chart" size={13} />
              {task.completionCount} completion{task.completionCount === 1 ? '' : 's'} logged
            </span>

            {/* A real two-step control, not a native confirm() dialog. */}
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
