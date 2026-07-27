import type { Workspace } from '@task-tracker/shared'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { TaskCard } from '../components/TaskCard'
import { useLayout, useMembers } from '../features/layout/api'
import { useTasks } from '../features/tasks/api'

/**
 * Pending on top, Completed below — the legacy shape, kept.
 *
 * Every filter lives in the query string, so a filtered view is linkable and
 * survives a reload (section 4.1). A floor filter means *any* room on that floor;
 * the legacy floor view meant *every* room, so adding a room silently hid
 * existing floor-wide tasks (Part 2, problem 8).
 */
export function TasksPage({
  workspace,
  flashing,
}: {
  workspace: Workspace
  flashing: Set<string>
}) {
  const [params, setParams] = useSearchParams()

  const roomId = params.get('roomId') ?? undefined
  const floorId = params.get('floorId') ?? undefined
  const search = params.get('search') ?? undefined
  const assignee = params.get('assignee') ?? 'anyone'

  const { data: layout } = useLayout(workspace.id)
  const { data: members } = useMembers(workspace.id)

  const scope = { roomId, floorId, search, assignee }
  const pending = useTasks(workspace.id, { ...scope, status: 'todo', limit: 200 })
  const completed = useTasks(workspace.id, { ...scope, status: 'done', limit: 50 })

  const setParam = (key: string, value: string | undefined): void => {
    const next = new URLSearchParams(params)
    if (value === undefined || value === '' || value === 'anyone') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const room = layout?.floors
    .flatMap((floor) => floor.rooms)
    .find((candidate) => candidate.id === roomId)
  const floor = layout?.floors.find((candidate) => candidate.id === floorId)
  const floorColor = room
    ? layout?.floors.find((candidate) => candidate.id === room.floorId)?.color
    : floor?.color

  const scopeIcon = room?.icon ?? floor?.icon
  const heading = room?.name ?? floor?.name ?? (search ? `“${search}”` : 'All tasks')
  const subtitle = room
    ? layout?.floors.find((candidate) => candidate.id === room.floorId)?.name
    : floor
      ? `${floor.rooms.length} room${floor.rooms.length === 1 ? '' : 's'}`
      : search
        ? 'Search results'
        : workspace.name

  const filtered = Boolean(roomId || floorId || search || assignee !== 'anyone')

  return (
    <div
      className="mx-auto max-w-3xl animate-rise"
      style={floorColor ? ({ '--floor': floorColor } as React.CSSProperties) : undefined}
    >
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex size-11 items-center justify-center rounded-2xl border text-xl ${
            scopeIcon ? 'floor-tint' : 'border-edge bg-ink-raised'
          }`}
        >
          {scopeIcon ?? <Icon name="list" size={20} className="text-text-dim" />}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{heading}</h1>
          <p className="truncate text-sm text-text-dim">{subtitle}</p>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label className="relative min-w-40 flex-1">
          <span className="sr-only">Search tasks</span>
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-dim"
          />
          <input
            type="search"
            defaultValue={search ?? ''}
            placeholder="Search tasks…"
            onChange={(event) => setParam('search', event.target.value.trim() || undefined)}
            className="field pl-9"
          />
        </label>

        <label className="relative">
          <span className="sr-only">Filter by assignee</span>
          <Icon
            name="filter"
            size={15}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-dim"
          />
          <select
            value={assignee}
            onChange={(event) => setParam('assignee', event.target.value)}
            className="field w-auto pr-2 pl-9 text-sm"
          >
            <option value="anyone">Anyone</option>
            <option value="mine">Mine</option>
            <option value="unassigned">Unassigned</option>
            {members?.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.name}
              </option>
            ))}
          </select>
        </label>

        {filtered && (
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="btn btn-sm"
          >
            <Icon name="x" size={14} />
            Clear
          </button>
        )}
      </div>

      <section className="mt-5">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-text-dim uppercase">
          <Icon name="inbox" size={15} />
          Pending
          {pending.data && pending.data.total > 0 && (
            <span className="chip tabular-nums">{pending.data.total}</span>
          )}
        </h2>

        {pending.isPending && (
          <div className="mt-2 space-y-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-20 animate-shimmer rounded-2xl bg-ink-raised" />
            ))}
          </div>
        )}

        {pending.data?.tasks.length === 0 && (
          <div className="mt-2 flex items-center gap-3 rounded-2xl border border-done/30 bg-done/10 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-done/15 text-done">
              <Icon name="sparkles" size={20} />
            </span>
            <p>
              <strong className="block font-medium">Nothing pending here</strong>
              <span className="text-sm text-text-dim">
                {filtered ? 'Try widening the filters.' : 'This part of the house is clear.'}
              </span>
            </p>
          </div>
        )}

        <div className="mt-2 space-y-2">
          {pending.data?.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              workspaceId={workspace.id}
              members={members ?? []}
              flashing={flashing.has(task.id)}
            />
          ))}
        </div>
      </section>

      <section className="mt-7">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-wide text-text-dim uppercase">
          <Icon name="checkCircle" size={15} />
          Completed
          {completed.data && completed.data.total > 0 && (
            <span className="chip tabular-nums">{completed.data.total}</span>
          )}
        </h2>

        {completed.data?.tasks.length === 0 && (
          <p className="mt-2 text-sm text-text-dim">No tasks completed yet.</p>
        )}

        <div className="mt-2 space-y-2">
          {completed.data?.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              workspaceId={workspace.id}
              members={members ?? []}
              flashing={flashing.has(task.id)}
            />
          ))}
        </div>

        {/* The legacy completed list was capped at 20 with no way to look further
            back (Part 2, gap 37). */}
        {completed.data?.hasMore && (
          <p className="mt-2 text-xs text-text-dim">
            Showing the {completed.data.tasks.length} most recent of {completed.data.total}.
          </p>
        )}
      </section>

      {!room && !floor && (
        <p className="mt-8 text-center text-sm text-text-dim">
          Looking for a particular room?{' '}
          <Link to={`/w/${workspace.id}/house`} className="text-accent-soft hover:underline">
            Open the floor plan
          </Link>
          .
        </p>
      )}
    </div>
  )
}
