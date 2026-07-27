import type { Workspace } from '@task-tracker/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useCreateFloor,
  useCreateRoom,
  useDeleteFloor,
  useDeleteRoom,
  useLayout,
  useStaleness,
  useUpdateFloor,
  useUpdateRoom,
} from '../features/layout/api'
import { stalenessLabel } from '../lib/format'

/**
 * The home view: the house, by floor.
 *
 * The spatial model is what makes this app different from a flat to-do list, so
 * this page answers "what needs attention?" spatially — badge counts plus room
 * staleness ("bathroom: nothing done in 12 days", section 5.4) rather than
 * another list.
 */
export function HomePage({ workspace }: { workspace: Workspace }) {
  const { data: layout, isPending } = useLayout(workspace.id)
  const { data: staleness } = useStaleness(workspace.id)
  const [addingFloor, setAddingFloor] = useState(false)

  const createFloor = useCreateFloor(workspace.id)

  const stalenessByRoom = new Map(
    (staleness?.rooms ?? []).map((room) => [room.roomId, room.daysSinceLastCompletion]),
  )

  if (isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-40 animate-pulse rounded-2xl border border-edge bg-ink-raised"
          />
        ))}
      </div>
    )
  }

  const floors = layout?.floors ?? []

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{workspace.name}</h1>
        <Link
          to={`/w/${workspace.id}/tasks`}
          className="tap flex items-center rounded-lg border border-edge px-3 text-sm text-text-dim hover:bg-ink-hover"
        >
          All tasks
        </Link>
      </div>

      {floors.length === 0 && !addingFloor && (
        <div className="rounded-2xl border border-dashed border-edge p-8 text-center">
          <p className="text-text-dim">
            No floors yet. A floor is a level of your home — “Ground floor”, “Upstairs”.
          </p>
          <button
            type="button"
            onClick={() => setAddingFloor(true)}
            className="tap mt-3 animate-pulse rounded-xl bg-text px-4 font-medium text-ink"
          >
            + Add your first floor
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {floors.map((floor) => (
          <FloorCard
            key={floor.id}
            workspace={workspace}
            floor={floor}
            stalenessByRoom={stalenessByRoom}
          />
        ))}
      </div>

      {addingFloor ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createFloor.mutate(
              {
                name: String(form.get('name') ?? '').trim(),
                icon: String(form.get('icon') ?? '🏠'),
                color: String(form.get('color') ?? '#8A2BE2'),
              },
              { onSuccess: () => setAddingFloor(false) },
            )
          }}
          className="mt-3 flex flex-wrap items-end gap-2 rounded-2xl border border-edge bg-ink-raised p-3"
        >
          <label className="text-sm">
            Icon
            <input
              name="icon"
              defaultValue="🏠"
              maxLength={16}
              className="tap mt-1 w-16 rounded-lg border border-edge bg-ink px-2 text-center"
            />
          </label>
          <label className="flex-1 text-sm">
            Floor name
            <input
              name="name"
              required
              maxLength={64}
              // biome-ignore lint/a11y/noAutofocus: focus belongs in the inline form the user just revealed
              autoFocus
              className="tap mt-1 w-full rounded-lg border border-edge bg-ink px-2"
            />
          </label>
          <label className="text-sm">
            Colour
            <input
              name="color"
              type="color"
              defaultValue="#8A2BE2"
              className="tap mt-1 block w-16 rounded-lg border border-edge bg-ink"
            />
          </label>
          <button type="submit" className="tap rounded-xl bg-text px-4 font-medium text-ink">
            Add
          </button>
          <button
            type="button"
            onClick={() => setAddingFloor(false)}
            className="tap rounded-xl border border-edge px-3 text-text-dim"
          >
            Cancel
          </button>
        </form>
      ) : (
        floors.length > 0 && (
          <button
            type="button"
            onClick={() => setAddingFloor(true)}
            className="tap mt-3 rounded-xl border border-dashed border-edge px-4 text-text-dim hover:bg-ink-hover"
          >
            + Floor
          </button>
        )
      )}
    </div>
  )
}

type Floor = NonNullable<ReturnType<typeof useLayout>['data']>['floors'][number]

function FloorCard({
  workspace,
  floor,
  stalenessByRoom,
}: {
  workspace: Workspace
  floor: Floor
  stalenessByRoom: Map<string, number | null>
}) {
  const [editing, setEditing] = useState(false)
  const [addingRoom, setAddingRoom] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updateFloor = useUpdateFloor(workspace.id)
  const deleteFloor = useDeleteFloor(workspace.id)
  const createRoom = useCreateRoom(workspace.id)

  const base = `/w/${workspace.id}`

  return (
    // The floor colour is set once here. Everything below derives from it —
    // one custom property instead of the legacy app's inline gradients.
    <section
      style={{ '--floor': floor.color } as React.CSSProperties}
      className="floor-tint floor-glow rounded-2xl border p-3"
    >
      <header className="flex items-center gap-2">
        <span aria-hidden="true" className="text-xl">
          {floor.icon}
        </span>
        <Link
          to={`${base}/tasks?floorId=${floor.id}`}
          className="min-w-0 flex-1 truncate font-semibold hover:underline"
        >
          {floor.name}
        </Link>
        {floor.openTaskCount > 0 && (
          <span className="rounded-full bg-black/30 px-2 text-xs">{floor.openTaskCount}</span>
        )}
        <button
          type="button"
          onClick={() => setEditing((open) => !open)}
          aria-label={`Edit ${floor.name}`}
          className="tap text-text-dim hover:text-text"
        >
          ✎
        </button>
      </header>

      {editing && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            updateFloor.mutate(
              {
                floorId: floor.id,
                name: String(form.get('name') ?? '').trim(),
                icon: String(form.get('icon') ?? floor.icon),
                color: String(form.get('color') ?? floor.color),
              },
              { onSuccess: () => setEditing(false) },
            )
          }}
          className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-black/20 p-2"
        >
          <input
            name="icon"
            defaultValue={floor.icon}
            maxLength={16}
            aria-label="Floor icon"
            className="tap w-14 rounded-lg border border-edge bg-ink px-1 text-center"
          />
          <input
            name="name"
            defaultValue={floor.name}
            maxLength={64}
            aria-label="Floor name"
            className="tap min-w-24 flex-1 rounded-lg border border-edge bg-ink px-2"
          />
          <input
            name="color"
            type="color"
            defaultValue={floor.color}
            aria-label="Floor colour"
            className="tap w-12 rounded-lg border border-edge bg-ink"
          />
          <button
            type="submit"
            className="tap rounded-lg bg-text px-3 text-sm font-medium text-ink"
          >
            Save
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1 text-xs">
              <span className="text-text-dim">Delete floor and its rooms?</span>
              <button
                type="button"
                onClick={() => deleteFloor.mutate(floor.id)}
                className="tap rounded-lg bg-urgent/25 px-2 text-urgent"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="tap rounded-lg border border-edge px-2 text-text-dim"
              >
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="tap rounded-lg border border-edge px-2 text-sm text-text-dim hover:text-urgent"
            >
              Delete
            </button>
          )}
        </form>
      )}

      <ul className="mt-2 space-y-1">
        {floor.rooms.map((room) => (
          <RoomRow
            key={room.id}
            workspace={workspace}
            room={room}
            staleDays={stalenessByRoom.get(room.id) ?? null}
          />
        ))}
      </ul>

      {addingRoom ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            createRoom.mutate(
              {
                floorId: floor.id,
                name: String(form.get('name') ?? '').trim(),
                icon: String(form.get('icon') ?? '🚪'),
              },
              { onSuccess: () => setAddingRoom(false) },
            )
          }}
          className="mt-2 flex items-end gap-1"
        >
          <input
            name="icon"
            defaultValue="🚪"
            maxLength={16}
            aria-label="Room icon"
            className="tap w-14 rounded-lg border border-edge bg-ink px-1 text-center"
          />
          <input
            name="name"
            required
            maxLength={64}
            // biome-ignore lint/a11y/noAutofocus: focus belongs in the inline form the user just revealed
            autoFocus
            placeholder="Room name"
            aria-label="Room name"
            className="tap min-w-0 flex-1 rounded-lg border border-edge bg-ink px-2"
          />
          <button
            type="submit"
            className="tap rounded-lg bg-text px-3 text-sm font-medium text-ink"
          >
            Add
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddingRoom(true)}
          className="tap mt-2 w-full rounded-lg border border-dashed border-edge/60 text-sm text-text-dim hover:bg-white/5"
        >
          + Room
        </button>
      )}
    </section>
  )
}

function RoomRow({
  workspace,
  room,
  staleDays,
}: {
  workspace: Workspace
  room: Floor['rooms'][number]
  staleDays: number | null
}) {
  const [editing, setEditing] = useState(false)
  const updateRoom = useUpdateRoom(workspace.id)
  const deleteRoom = useDeleteRoom(workspace.id)

  if (editing) {
    return (
      <li>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            updateRoom.mutate(
              {
                roomId: room.id,
                name: String(form.get('name') ?? '').trim(),
                icon: String(form.get('icon') ?? room.icon),
              },
              { onSuccess: () => setEditing(false) },
            )
          }}
          className="flex items-center gap-1"
        >
          <input
            name="icon"
            defaultValue={room.icon}
            maxLength={16}
            aria-label="Room icon"
            className="tap w-12 rounded-lg border border-edge bg-ink px-1 text-center"
          />
          <input
            name="name"
            defaultValue={room.name}
            maxLength={64}
            aria-label="Room name"
            className="tap min-w-0 flex-1 rounded-lg border border-edge bg-ink px-2"
          />
          <button type="submit" className="tap rounded-lg bg-text px-2 text-sm text-ink">
            ✓
          </button>
          <button
            type="button"
            onClick={() => deleteRoom.mutate(room.id)}
            aria-label={`Delete ${room.name}`}
            className="tap rounded-lg border border-edge px-2 text-sm text-text-dim hover:text-urgent"
          >
            ✕
          </button>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-white/5">
      <Link
        to={`/w/${workspace.id}/tasks?roomId=${room.id}`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span aria-hidden="true">{room.icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{room.name}</span>
        {/* Excludes soft-deleted tasks, unlike the legacy badge. */}
        {room.openTaskCount > 0 && (
          <span className="rounded-full bg-black/30 px-2 text-xs">{room.openTaskCount}</span>
        )}
      </Link>
      <span
        className={`hidden text-xs sm:inline ${staleDays !== null && staleDays >= 10 ? 'text-special' : 'text-text-dim'}`}
        title="From the completion log"
      >
        {stalenessLabel(staleDays)}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${room.name}`}
        className="tap text-text-dim hover:text-text"
      >
        ✎
      </button>
    </li>
  )
}
