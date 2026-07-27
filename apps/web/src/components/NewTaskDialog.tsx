import type { RecurrenceUnit, TaskCategory, Workspace } from '@task-tracker/shared'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLayout, useMembers } from '../features/layout/api'
import { useCreateTask } from '../features/tasks/api'
import { ApiRequestError } from '../lib/api'
import { localInputToIso } from '../lib/format'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'

/**
 * New task.
 *
 * Two deliberate departures from the legacy modal: the description is optional
 * (the legacy *form* required it while the model allowed blank), and zero rooms
 * is allowed — a whole-flat chore like "book a plumber" belongs to the household,
 * not to a room.
 *
 * On a phone it is a bottom sheet, because that is where a thumb is (section 5.5).
 */
export function NewTaskDialog({
  workspace,
  onClose,
}: {
  workspace: Workspace
  onClose: () => void
}) {
  const [params] = useSearchParams()
  const { data: layout } = useLayout(workspace.id)
  const { data: members } = useMembers(workspace.id)
  const create = useCreateTask(workspace.id)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TaskCategory>('normal')
  const [dueDate, setDueDate] = useState('')
  const [every, setEvery] = useState('')
  const [unit, setUnit] = useState<RecurrenceUnit>('week')
  const [anchor, setAnchor] = useState<'completion' | 'dueDate'>('completion')
  const [rotate, setRotate] = useState(false)

  // Opened from a room or floor view, that scope is pre-selected.
  const scopedRoom = params.get('roomId')
  const scopedFloor = params.get('floorId')
  const preselected = new Set<string>(
    scopedRoom
      ? [scopedRoom]
      : scopedFloor
        ? (layout?.floors.find((floor) => floor.id === scopedFloor)?.rooms ?? []).map(
            (room) => room.id,
          )
        : [],
  )
  const [roomIds, setRoomIds] = useState<Set<string>>(preselected)
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set())

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const recurring = every.trim().length > 0
  const error = create.error instanceof ApiRequestError ? create.error : undefined

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    create.mutate(
      {
        name: name.trim(),
        description: description.trim(),
        category,
        dueDate: dueDate ? localInputToIso(dueDate) : null,
        recurrenceEvery: recurring ? Number(every) : null,
        recurrenceUnit: recurring ? unit : null,
        recurrenceAnchor: anchor,
        rotateAssignees: rotate,
        roomIds: [...roomIds],
        assigneeIds: [...assigneeIds],
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-(--scrim) p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New task"
    >
      <form
        onSubmit={submit}
        className="card max-h-[92dvh] w-full max-w-lg animate-rise overflow-y-auto rounded-t-2xl rounded-b-none p-4 sm:rounded-2xl"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-accent/15 text-accent-soft"
          >
            <Icon name="plus" size={19} />
          </span>
          <h2 className="flex-1 text-lg font-semibold">New task</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="icon-btn">
            <Icon name="x" size={18} />
          </button>
        </div>

        <label className="mt-4 block text-sm">
          What needs doing?
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={128}
            placeholder="Vacuum the living room"
            // biome-ignore lint/a11y/noAutofocus: focus belongs in the dialog the user just opened
            autoFocus
            className="field mt-1"
          />
        </label>

        <label className="mt-3 block text-sm">
          Description <span className="text-text-dim">(optional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={512}
            rows={2}
            className="field mt-1 min-h-0 py-2"
          />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="flex items-center gap-1.5">
              <Icon name="filter" size={14} className="text-text-dim" />
              Category
            </span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as TaskCategory)}
              className="field mt-1"
            >
              <option value="urgent">Urgent</option>
              <option value="special">Special</option>
              <option value="normal">Normal</option>
            </select>
          </label>

          <label className="text-sm">
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={14} className="text-text-dim" />
              Deadline <span className="text-text-dim">(optional)</span>
            </span>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="field mt-1"
            />
          </label>
        </div>

        <Section icon="repeat" title="Repeats">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-dim">every</span>
            <input
              type="number"
              min={1}
              max={365}
              value={every}
              onChange={(event) => setEvery(event.target.value)}
              placeholder="—"
              aria-label="Repeat interval"
              className="field w-20 text-center"
            />
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value as RecurrenceUnit)}
              disabled={!recurring}
              aria-label="Repeat unit"
              className="field w-auto"
            >
              <option value="day">days</option>
              <option value="week">weeks</option>
              <option value="month">months</option>
            </select>
            <span className="text-xs text-text-dim">Leave empty for a one-off.</span>
          </div>

          {recurring && (
            <>
              <label className="mt-2 block text-sm">
                Measured from
                <select
                  value={anchor}
                  onChange={(event) => setAnchor(event.target.value as 'completion' | 'dueDate')}
                  className="field mt-1"
                >
                  <option value="completion">when it was actually done</option>
                  <option value="dueDate">the previous due date (fixed cadence)</option>
                </select>
              </label>

              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={rotate}
                  onChange={(event) => setRotate(event.target.checked)}
                  className="size-4 accent-accent"
                />
                <Icon name="swap" size={15} className="text-text-dim" />
                Hand it to the next person each time
              </label>
            </>
          )}
        </Section>

        {(layout?.floors.length ?? 0) > 0 && (
          <Section icon="door" title="Rooms" hint="optional">
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {layout?.floors.map((floor) => (
                <div key={floor.id} style={{ '--floor': floor.color } as React.CSSProperties}>
                  <p className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
                    <span aria-hidden="true" className="floor-dot inline-block" />
                    {floor.icon} {floor.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {floor.rooms.map((room) => (
                      <button
                        key={room.id}
                        type="button"
                        aria-pressed={roomIds.has(room.id)}
                        onClick={() => setRoomIds((current) => toggle(current, room.id))}
                        className={[
                          'flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm transition-colors',
                          roomIds.has(room.id)
                            ? 'floor-tint border-transparent text-text'
                            : 'border-edge text-text-dim hover:bg-ink-hover hover:text-text',
                        ].join(' ')}
                      >
                        <span aria-hidden="true">{room.icon}</span>
                        {room.name}
                        {roomIds.has(room.id) && <Icon name="check" size={13} />}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section icon="users" title="Assign to" hint="optional">
          <div className="flex flex-wrap gap-1.5">
            {members?.map((member) => (
              <button
                key={member.user.id}
                type="button"
                aria-pressed={assigneeIds.has(member.user.id)}
                onClick={() => setAssigneeIds((current) => toggle(current, member.user.id))}
                className={[
                  'flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors',
                  assigneeIds.has(member.user.id)
                    ? 'border-accent/40 bg-accent/15 text-text'
                    : 'border-edge text-text-dim hover:bg-ink-hover hover:text-text',
                ].join(' ')}
              >
                <Avatar user={member.user} size={22} />
                {member.user.name}
                {assigneeIds.has(member.user.id) && (
                  <Icon name="check" size={13} className="text-accent-soft" />
                )}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-text-dim">Leave empty for “whoever gets to it”.</p>
        </Section>

        {error && (
          <p
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-xl bg-urgent/15 px-3 py-2 text-sm text-urgent"
          >
            <Icon name="alert" size={16} />
            {error.message}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={create.isPending || name.trim().length === 0}
            className="btn btn-primary flex-1"
          >
            <Icon name="check" size={18} />
            {create.isPending ? 'Adding…' : 'Add task'}
          </button>
          <button type="button" onClick={onClose} className="btn">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: IconName
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="mt-3 rounded-xl border border-edge p-2.5">
      <legend className="flex items-center gap-1.5 px-1 text-sm">
        <Icon name={icon} size={14} className="text-text-dim" />
        {title}
        {hint && <span className="text-text-dim">({hint})</span>}
      </legend>
      {children}
    </fieldset>
  )
}
