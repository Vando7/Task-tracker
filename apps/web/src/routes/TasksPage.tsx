import type { Workspace } from '@task-tracker/shared'
import { useSearchParams } from 'react-router-dom'
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

  const heading = room
    ? `${room.icon} ${room.name}`
    : floor
      ? `${floor.icon} ${floor.name}`
      : search
        ? `Search: “${search}”`
        : 'All tasks'

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">{heading}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          defaultValue={search ?? ''}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          onChange={(event) => setParam('search', event.target.value.trim() || undefined)}
          className="tap min-w-40 flex-1 rounded-xl border border-edge bg-ink-raised px-3"
        />

        <label className="text-sm">
          <span className="sr-only">Filter by assignee</span>
          <select
            value={assignee}
            onChange={(event) => setParam('assignee', event.target.value)}
            className="tap rounded-xl border border-edge bg-ink-raised px-2 text-sm"
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

        {(roomId || floorId || search || assignee !== 'anyone') && (
          <button
            type="button"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
            className="tap rounded-xl border border-edge px-3 text-sm text-text-dim hover:bg-ink-hover"
          >
            Clear
          </button>
        )}
      </div>

      <section className="mt-5">
        <h2 className="text-sm font-medium tracking-wide text-text-dim uppercase">Pending</h2>

        {pending.isPending && (
          <div className="mt-2 space-y-2">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-xl border border-edge bg-ink-raised"
              />
            ))}
          </div>
        )}

        {pending.data?.tasks.length === 0 && (
          <p className="mt-2 rounded-xl border border-done/30 bg-done/10 p-4 text-center">
            Congratulations! Nothing pending here. 🎉
          </p>
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

      <section className="mt-6">
        <h2 className="text-sm font-medium tracking-wide text-text-dim uppercase">
          Completed
          {completed.data && completed.data.total > 0 && (
            <span className="ml-2 normal-case">({completed.data.total})</span>
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
    </div>
  )
}
