import type { Floor, Room, Workspace } from '@task-tracker/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import {
  useCreateFloor,
  useCreateRoom,
  useDeleteFloor,
  useDeleteRoom,
  useLayout,
  useUpdateFloor,
  useUpdateRoom,
} from '../features/layout/api'
import { useStaleness } from '../features/stats/api'
import { stalenessLabel, stalenessShort } from '../lib/format'

/**
 * The house, by floor — and the only place its shape is edited.
 *
 * The spatial model is what makes this app different from a flat to-do list, so
 * this page answers "what needs attention?" spatially — badge counts plus room
 * staleness ("bathroom: nothing done in 12 days") rather than
 * another list. The landing page is `DashboardPage`; this one is reached from it.
 */
export function HousePage({ workspace }: { workspace: Workspace }) {
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
          <div key={index} className="h-44 animate-shimmer rounded-2xl bg-ink-raised" />
        ))}
      </div>
    )
  }

  const floors = layout?.floors ?? []
  const roomCount = floors.reduce((total, floor) => total + floor.rooms.length, 0)

  return (
    <div className="mx-auto max-w-6xl animate-rise">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Icon name="layers" size={19} className="text-text-dim" />
            Your house
          </h1>
          <p className="text-sm text-text-dim">
            {floors.length} floor{floors.length === 1 ? '' : 's'} · {roomCount} room
            {roomCount === 1 ? '' : 's'} in {workspace.name}. Tap a room to see its tasks.
          </p>
        </div>
        <Link to={`/w/${workspace.id}/tasks`} className="btn btn-sm">
          <Icon name="list" size={16} />
          All tasks
        </Link>
      </div>

      {floors.length === 0 && !addingFloor && (
        <div className="card p-8 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/15 text-accent-soft">
            <Icon name="layers" size={24} />
          </span>
          <h2 className="mt-3 text-lg font-semibold">Start with a floor</h2>
          <p className="mx-auto mt-1 max-w-sm text-text-dim">
            A floor is a level of your home — “Ground floor”, “Upstairs”. Rooms live inside it, and
            chores live in rooms.
          </p>
          <button
            type="button"
            onClick={() => setAddingFloor(true)}
            className="btn btn-primary mx-auto mt-4"
          >
            <Icon name="plus" size={18} />
            Add your first floor
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
          className="card mt-3 flex flex-wrap items-end gap-2 p-3"
        >
          <label className="text-sm">
            Icon
            <input
              name="icon"
              defaultValue="🏠"
              maxLength={16}
              className="field mt-1 w-16 text-center"
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
              className="field mt-1"
            />
          </label>
          <label className="text-sm">
            Colour
            <input name="color" type="color" defaultValue="#8A2BE2" className="field mt-1 w-16" />
          </label>
          <button type="submit" className="btn btn-primary">
            <Icon name="check" size={17} />
            Add floor
          </button>
          <button type="button" onClick={() => setAddingFloor(false)} className="btn btn-ghost">
            Cancel
          </button>
        </form>
      ) : (
        floors.length > 0 && (
          <button
            type="button"
            onClick={() => setAddingFloor(true)}
            className="btn mt-3 w-full border-dashed"
          >
            <Icon name="plus" size={17} />
            Add a floor
          </button>
        )
      )}
    </div>
  )
}

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
        {floor.openTaskCount > 0 && <span className="count-badge">{floor.openTaskCount}</span>}
        <button
          type="button"
          onClick={() => setEditing((open) => !open)}
          aria-expanded={editing}
          aria-label={`Edit ${floor.name}`}
          className="icon-btn icon-btn-ghost"
        >
          <Icon name={editing ? 'chevronUp' : 'pencil'} size={17} />
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
          className="mt-2 space-y-2 rounded-xl bg-ink-sunken/70 p-2"
        >
          {/* Two rows rather than one wrapping line: at card width a single row
              squeezed the name field down to about ten characters. */}
          <div className="flex items-center gap-2">
            <input
              name="icon"
              defaultValue={floor.icon}
              maxLength={16}
              aria-label="Floor icon"
              className="field w-14 shrink-0 text-center"
            />
            <input
              name="name"
              defaultValue={floor.name}
              maxLength={64}
              aria-label="Floor name"
              className="field min-w-0 flex-1"
            />
            <input
              name="color"
              type="color"
              defaultValue={floor.color}
              aria-label="Floor colour"
              className="field w-12 shrink-0"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button type="submit" className="btn btn-sm btn-primary">
              <Icon name="check" size={15} />
              Save
            </button>
            {confirmDelete ? (
              <>
                <span className="text-xs text-text-dim">Delete the floor and its rooms?</span>
                <button
                  type="button"
                  onClick={() => deleteFloor.mutate(floor.id)}
                  className="btn btn-sm btn-danger"
                >
                  <Icon name="trash" size={14} />
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="btn btn-sm"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="btn btn-sm btn-quiet-danger ml-auto"
              >
                <Icon name="trash" size={15} />
                Delete floor
              </button>
            )}
          </div>
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
          className="mt-2 flex items-center gap-1.5"
        >
          <input
            name="icon"
            defaultValue="🚪"
            maxLength={16}
            aria-label="Room icon"
            className="field w-14 text-center"
          />
          <input
            name="name"
            required
            maxLength={64}
            // biome-ignore lint/a11y/noAutofocus: focus belongs in the inline form the user just revealed
            autoFocus
            placeholder="Room name"
            aria-label="Room name"
            className="field min-w-0 flex-1"
          />
          <button type="submit" aria-label="Add room" className="icon-btn icon-btn-primary">
            <Icon name="check" size={17} />
          </button>
          <button
            type="button"
            onClick={() => setAddingRoom(false)}
            aria-label="Cancel"
            className="icon-btn"
          >
            <Icon name="x" size={17} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAddingRoom(true)}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge/60 py-2 text-sm text-text-dim hover:bg-ink-hover/40 hover:text-text"
        >
          <Icon name="plus" size={15} />
          Room
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
  room: Room
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
          className="flex items-center gap-1.5"
        >
          <input
            name="icon"
            defaultValue={room.icon}
            maxLength={16}
            aria-label="Room icon"
            className="field w-12 text-center"
          />
          <input
            name="name"
            defaultValue={room.name}
            maxLength={64}
            aria-label="Room name"
            className="field min-w-0 flex-1"
          />
          <button type="submit" aria-label="Save room" className="icon-btn icon-btn-primary">
            <Icon name="check" size={16} />
          </button>
          <button
            type="button"
            onClick={() => deleteRoom.mutate(room.id)}
            aria-label={`Delete ${room.name}`}
            className="icon-btn icon-btn-danger"
          >
            <Icon name="trash" size={16} />
          </button>
        </form>
      </li>
    )
  }

  const stale = staleDays !== null && staleDays >= 10

  return (
    <li className="group flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-ink-hover/40">
      <Link
        to={`/w/${workspace.id}/tasks?roomId=${room.id}`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <span aria-hidden="true">{room.icon}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{room.name}</span>
        {/* Excludes soft-deleted tasks, unlike the legacy badge. */}
        {room.openTaskCount > 0 && <span className="count-badge">{room.openTaskCount}</span>}
      </Link>
      {/* Compact here so the room name never has to truncate to make room for it;
          the full sentence is in the tooltip, and on the dashboard's "needs
          attention" panel, where there is space, it is spelled out. */}
      <span
        className={`hidden shrink-0 items-center gap-1 text-xs sm:flex ${stale ? 'text-special' : 'text-text-dim'}`}
        title={stalenessLabel(staleDays)}
      >
        <Icon name="clock" size={12} />
        {stalenessShort(staleDays)}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${room.name}`}
        className="icon-btn icon-btn-ghost"
      >
        <Icon name="pencil" size={15} />
      </button>
    </li>
  )
}
