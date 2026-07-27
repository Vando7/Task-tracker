import type { RecurrenceUnit, TaskCategory, Workspace } from '@task-tracker/shared'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLayout, useMembers } from '../features/layout/api'
import { useCreateTask } from '../features/tasks/api'
import { ApiRequestError } from '../lib/api'
import { localInputToIso } from '../lib/format'

/**
 * New task.
 *
 * Two deliberate departures from the legacy modal: the description is optional
 * (the legacy *form* required it while the model allowed blank), and zero rooms
 * is allowed — a whole-flat chore like "book a plumber" belongs to the household,
 * not to a room.
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
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New task"
    >
      <form
        onSubmit={submit}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-edge bg-ink-raised p-4 sm:rounded-2xl"
      >
        <h2 className="text-lg font-semibold">New task</h2>

        <label className="mt-3 block text-sm">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={128}
            // biome-ignore lint/a11y/noAutofocus: focus belongs in the dialog the user just opened
            autoFocus
            className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-2"
          />
        </label>

        <label className="mt-3 block text-sm">
          Description <span className="text-text-dim">(optional)</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={512}
            rows={2}
            className="mt-1 w-full rounded-lg border border-edge bg-ink px-2 py-1"
          />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as TaskCategory)}
              className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-2"
            >
              <option value="urgent">Urgent</option>
              <option value="special">Special</option>
              <option value="normal">Normal</option>
            </select>
          </label>

          <label className="text-sm">
            Deadline <span className="text-text-dim">(optional)</span>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-2"
            />
          </label>
        </div>

        <fieldset className="mt-3 rounded-lg border border-edge p-2">
          <legend className="px-1 text-sm">Repeats</legend>
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
              className="tap w-20 rounded-lg border border-edge bg-ink px-2"
            />
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value as RecurrenceUnit)}
              disabled={!recurring}
              aria-label="Repeat unit"
              className="tap rounded-lg border border-edge bg-ink px-2 disabled:opacity-40"
            >
              <option value="day">days</option>
              <option value="week">weeks</option>
              <option value="month">months</option>
            </select>
            <span className="text-text-dim">Leave empty for a one-off.</span>
          </div>

          {recurring && (
            <>
              <label className="mt-2 block text-sm">
                Measured from
                <select
                  value={anchor}
                  onChange={(event) => setAnchor(event.target.value as 'completion' | 'dueDate')}
                  className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-2"
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
                  className="size-4"
                />
                Hand it to the next person each time
              </label>
            </>
          )}
        </fieldset>

        {(layout?.floors.length ?? 0) > 0 && (
          <fieldset className="mt-3 rounded-lg border border-edge p-2">
            <legend className="px-1 text-sm">
              Rooms <span className="text-text-dim">(optional)</span>
            </legend>
            <div className="max-h-40 space-y-2 overflow-y-auto">
              {layout?.floors.map((floor) => (
                <div key={floor.id} style={{ '--floor': floor.color } as React.CSSProperties}>
                  <p className="text-xs font-medium text-text-dim">
                    {floor.icon} {floor.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {floor.rooms.map((room) => (
                      <button
                        key={room.id}
                        type="button"
                        aria-pressed={roomIds.has(room.id)}
                        onClick={() => setRoomIds((current) => toggle(current, room.id))}
                        className={[
                          'rounded-full border px-2 py-1 text-sm',
                          roomIds.has(room.id)
                            ? 'floor-tint border-transparent text-text'
                            : 'border-edge text-text-dim',
                        ].join(' ')}
                      >
                        {room.icon} {room.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset className="mt-3 rounded-lg border border-edge p-2">
          <legend className="px-1 text-sm">
            Assign to <span className="text-text-dim">(optional)</span>
          </legend>
          <div className="flex flex-wrap gap-1">
            {members?.map((member) => (
              <button
                key={member.user.id}
                type="button"
                aria-pressed={assigneeIds.has(member.user.id)}
                onClick={() => setAssigneeIds((current) => toggle(current, member.user.id))}
                className={[
                  'rounded-full border px-2 py-1 text-sm',
                  assigneeIds.has(member.user.id)
                    ? 'border-transparent bg-ink-hover text-text'
                    : 'border-edge text-text-dim',
                ].join(' ')}
              >
                {member.user.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-text-dim">Leave empty for “whoever gets to it”.</p>
        </fieldset>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-urgent/15 px-2 py-1 text-sm text-urgent">
            {error.message}
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={create.isPending || name.trim().length === 0}
            className="tap flex-1 rounded-xl bg-text px-3 font-medium text-ink disabled:opacity-50"
          >
            {create.isPending ? 'Adding…' : 'Add task'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="tap rounded-xl border border-edge px-4 text-text-dim"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
