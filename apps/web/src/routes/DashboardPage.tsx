import type { Me, Member, Task, Workspace } from '@task-tracker/shared'
import { TASK_CATEGORY_RANK } from '@task-tracker/shared'
import { Link } from 'react-router-dom'
import { AssigneeStack, Avatar } from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { TaskCard } from '../components/TaskCard'
import { useLayout, useMembers } from '../features/layout/api'
import { useFairness, useStaleness } from '../features/stats/api'
import { useTasks } from '../features/tasks/api'
import { greetingIn, isDueToday, longDateIn, relativeTime, stalenessLabel } from '../lib/format'

/**
 * The landing page: what needs doing, in the order a person actually cares.
 *
 * Yours first, then the pile nobody has taken, then how the house as a whole is
 * doing. The legacy app landed you on the floor plan, which is a lovely picture
 * of the *building* but never answered "what am I on the hook for?" — you had to
 * open rooms one by one to find out.
 *
 * One pending-task query feeds every section here and is partitioned in the
 * client. Three server round-trips for mine/unassigned/others would return the
 * same rows and still not give the counts.
 */
export function DashboardPage({
  workspace,
  me,
  flashing,
}: {
  workspace: Workspace
  me: Me
  flashing: Set<string>
}) {
  const pending = useTasks(workspace.id, { status: 'todo', limit: 200 })
  const { data: layout } = useLayout(workspace.id)
  const { data: members } = useMembers(workspace.id)
  const { data: staleness } = useStaleness(workspace.id)
  const { data: fairness } = useFairness(workspace.id, 'week')

  const base = `/w/${workspace.id}`
  const tasks = pending.data?.tasks ?? []
  const zone = workspace.timezone

  const mine = tasks.filter((task) =>
    task.assignees.some((assignee) => assignee.user.id === me.user.id),
  )
  const unassigned = tasks.filter((task) => task.assignees.length === 0)
  const theirs = tasks.filter(
    (task) =>
      task.assignees.length > 0 &&
      !task.assignees.some((assignee) => assignee.user.id === me.user.id),
  )

  const overdue = tasks.filter((task) => task.isOverdue)
  const dueToday = tasks.filter((task) => !task.isOverdue && isDueToday(task.dueDate, zone))

  const floors = layout?.floors ?? []
  const rooms = staleness?.rooms ?? []
  /** Rooms with work waiting, stalest first — "what needs attention?" (section 5.4). */
  const needsAttention = [...rooms]
    .filter((room) => room.openTaskCount > 0)
    .sort((a, b) => (b.daysSinceLastCompletion ?? 999) - (a.daysSinceLastCompletion ?? 999))
    .slice(0, 4)

  if (pending.isPending) return <DashboardSkeleton />

  return (
    <div className="mx-auto max-w-6xl animate-rise">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-text-dim">{longDateIn(zone)}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {greetingIn(zone)}, {me.user.name.split(' ')[0]}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`${base}/house`} className="btn btn-sm">
            <Icon name="layers" size={16} />
            The house
          </Link>
          <Link to={`${base}/tasks`} className="btn btn-sm">
            <Icon name="list" size={16} />
            All tasks
          </Link>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat
          icon="alert"
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? 'urgent' : 'plain'}
        />
        <Stat
          icon="clock"
          label="Due today"
          value={dueToday.length}
          tone={dueToday.length > 0 ? 'special' : 'plain'}
        />
        <Stat icon="inbox" label="Still to do" value={tasks.length} tone="plain" />
        <Stat
          icon="checkCircle"
          label="Done this week"
          value={fairness?.total ?? 0}
          tone={(fairness?.total ?? 0) > 0 ? 'done' : 'plain'}
        />
      </div>

      {pending.data?.hasMore && (
        <p className="mt-2 text-xs text-text-dim">
          Counting the {tasks.length} most relevant of {pending.data.total} open tasks.
        </p>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section>
            <SectionHeader
              icon="user"
              title="Yours"
              count={mine.length}
              action={
                mine.length > 0
                  ? { to: `${base}/tasks?assignee=mine`, label: 'See all yours' }
                  : undefined
              }
            />
            {mine.length === 0 ? (
              <Empty
                icon="sparkles"
                title="Nothing assigned to you"
                body={
                  unassigned.length > 0
                    ? 'Nothing has your name on it. There is a pile going spare below.'
                    : 'Nothing has your name on it, and nothing is waiting to be claimed.'
                }
              />
            ) : (
              <TaskColumn
                tasks={mine}
                workspace={workspace}
                members={members ?? []}
                flashing={flashing}
                showAllHref={`${base}/tasks?assignee=mine`}
              />
            )}
          </section>

          <section>
            <SectionHeader
              icon="inbox"
              title="Up for grabs"
              count={unassigned.length}
              hint="Nobody has taken these"
              action={
                unassigned.length > 0
                  ? { to: `${base}/tasks?assignee=unassigned`, label: 'See all' }
                  : undefined
              }
            />
            {unassigned.length === 0 ? (
              <Empty
                icon="checkCircle"
                title="Everything open has an owner"
                body="Nothing is sitting unclaimed in this house."
              />
            ) : (
              <TaskColumn
                tasks={unassigned}
                workspace={workspace}
                members={members ?? []}
                flashing={flashing}
                claimUserId={me.user.id}
                showAllHref={`${base}/tasks?assignee=unassigned`}
              />
            )}
          </section>
        </div>

        <div className="space-y-4">
          {needsAttention.length > 0 && (
            <Panel icon="alert" title="Needs attention">
              <ul className="space-y-1">
                {needsAttention.map((room) => (
                  <li key={room.roomId}>
                    <Link
                      to={`${base}/tasks?roomId=${room.roomId}`}
                      className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-ink-hover"
                    >
                      <span aria-hidden="true" className="text-lg">
                        {room.roomIcon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{room.roomName}</span>
                        <span className="block truncate text-xs text-text-dim">
                          {room.floorName} · {stalenessLabel(room.daysSinceLastCompletion)}
                        </span>
                      </span>
                      <span className="chip">{room.openTaskCount} open</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            icon="users"
            title="Who's on what"
            action={{ to: `${base}/tasks`, label: 'Filter tasks' }}
          >
            <ul className="space-y-1">
              {(members ?? []).map((member) => {
                const assigned = tasks.filter((task) =>
                  task.assignees.some((assignee) => assignee.user.id === member.user.id),
                )
                const late = assigned.filter((task) => task.isOverdue).length
                return (
                  <li key={member.user.id}>
                    <Link
                      to={`${base}/tasks?assignee=${member.user.id}`}
                      className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-ink-hover"
                    >
                      <Avatar user={member.user} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {member.user.id === me.user.id ? 'You' : member.user.name}
                        </span>
                        {late > 0 && (
                          <span className="block text-xs text-urgent">{late} overdue</span>
                        )}
                      </span>
                      <span className="chip tabular-nums">{assigned.length}</span>
                    </Link>
                  </li>
                )
              })}
              {unassigned.length > 0 && (
                <li>
                  <Link
                    to={`${base}/tasks?assignee=unassigned`}
                    className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-ink-hover"
                  >
                    <span className="flex size-[30px] items-center justify-center rounded-full border border-dashed border-edge-strong text-text-dim">
                      <Icon name="inbox" size={15} />
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-text-dim italic">anyone</span>
                    <span className="chip tabular-nums">{unassigned.length}</span>
                  </Link>
                </li>
              )}
            </ul>
          </Panel>

          <Panel
            icon="chart"
            title="This week"
            hint="Completions from the log. No points, no streaks."
            action={{ to: `${base}/settings`, label: 'More' }}
          >
            {fairness && fairness.total > 0 ? (
              <ul className="space-y-2">
                {fairness.rows
                  .filter((row) => row.completions > 0)
                  .map((row) => {
                    const most = Math.max(...fairness.rows.map((other) => other.completions), 1)
                    return (
                      <li key={row.user.id} className="flex items-center gap-2">
                        <Avatar user={row.user} size={24} />
                        <span className="w-20 shrink-0 truncate text-sm">
                          {row.user.id === me.user.id ? 'You' : row.user.name}
                        </span>
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-sunken">
                          <span
                            className="block h-full rounded-full bg-linear-to-r from-done/70 to-done transition-[width] duration-500"
                            style={{ width: `${(row.completions / most) * 100}%` }}
                          />
                        </span>
                        <span className="w-6 text-right text-sm tabular-nums">
                          {row.completions}
                        </span>
                      </li>
                    )
                  })}
              </ul>
            ) : (
              <p className="text-sm text-text-dim">
                Nothing completed yet this week. The tally starts when someone ticks something off.
              </p>
            )}
          </Panel>

          <Panel
            icon="layers"
            title="The house"
            action={{ to: `${base}/house`, label: 'Edit rooms' }}
          >
            {floors.length === 0 ? (
              <p className="text-sm text-text-dim">
                No floors yet.{' '}
                <Link to={`${base}/house`} className="text-accent-soft hover:underline">
                  Add the first one
                </Link>{' '}
                to place chores in rooms.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {floors.map((floor) => (
                  <li
                    key={floor.id}
                    style={{ '--floor': floor.color } as React.CSSProperties}
                    className="rounded-xl border floor-tint px-2 py-1.5"
                  >
                    <Link
                      to={`${base}/tasks?floorId=${floor.id}`}
                      className="flex items-center gap-2"
                    >
                      <span aria-hidden="true">{floor.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {floor.name}
                      </span>
                      <span className="text-xs text-text-dim">
                        {floor.rooms.length} room{floor.rooms.length === 1 ? '' : 's'}
                      </span>
                      {floor.openTaskCount > 0 && (
                        <span className="count-badge">{floor.openTaskCount}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {theirs.length > 0 && (
            <Panel icon="user" title="On someone else's plate" hint={`${theirs.length} open`}>
              <ul className="space-y-1">
                {byUrgency(theirs)
                  .slice(0, 5)
                  .map((task) => (
                    <li key={task.id} className="flex items-center gap-2 px-1 py-1">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{task.name}</span>
                        {task.dueDate && (
                          <span
                            className={`block text-xs ${task.isOverdue ? 'text-urgent' : 'text-text-dim'}`}
                          >
                            {task.isOverdue ? 'overdue · ' : 'due '}
                            {relativeTime(task.dueDate)}
                          </span>
                        )}
                      </span>
                      <AssigneeStack
                        users={task.assignees.map((assignee) => assignee.user)}
                        size={22}
                      />
                    </li>
                  ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {tasks.length === 0 && floors.length > 0 && (
        <div className="mt-6 card p-8 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-done/15 text-done">
            <Icon name="sparkles" size={24} />
          </span>
          <h2 className="mt-3 text-lg font-semibold">The whole house is clear</h2>
          <p className="mt-1 text-text-dim">
            Nothing is pending anywhere. Add a chore when something comes up.
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Overdue first, then soonest deadline, then category, then most recently
 * touched. The server orders by category for the task lists, which is right
 * there — but a dashboard is read top-down, so a deadline outranks a label here.
 */
function byUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1
    if (Boolean(a.dueDate) !== Boolean(b.dueDate)) return a.dueDate ? -1 : 1
    const rank = TASK_CATEGORY_RANK[a.category] - TASK_CATEGORY_RANK[b.category]
    if (rank !== 0) return rank
    return a.updatedAt < b.updatedAt ? 1 : -1
  })
}

const PREVIEW_COUNT = 5

function TaskColumn({
  tasks,
  workspace,
  members,
  flashing,
  claimUserId,
  showAllHref,
}: {
  tasks: Task[]
  workspace: Workspace
  members: Member[]
  flashing: Set<string>
  claimUserId?: string
  showAllHref: string
}) {
  const ordered = byUrgency(tasks)
  const shown = ordered.slice(0, PREVIEW_COUNT)
  const rest = ordered.length - shown.length

  return (
    <>
      <div className="mt-2 space-y-2">
        {shown.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            workspaceId={workspace.id}
            members={members}
            flashing={flashing.has(task.id)}
            claimUserId={claimUserId}
          />
        ))}
      </div>
      {rest > 0 && (
        <Link
          to={showAllHref}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge px-3 py-2 text-sm text-text-dim hover:bg-ink-hover hover:text-text"
        >
          {rest} more
          <Icon name="arrowRight" size={15} />
        </Link>
      )}
    </>
  )
}

const STAT_TONES = {
  plain: 'text-text-dim bg-ink-hover',
  urgent: 'text-urgent bg-urgent/15',
  special: 'text-special bg-special/15',
  done: 'text-done bg-done/15',
} as const

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName
  label: string
  value: number
  tone: keyof typeof STAT_TONES
}) {
  return (
    <div className="card hover-lift flex items-center gap-3 p-3">
      <span className={`flex size-9 items-center justify-center rounded-xl ${STAT_TONES[tone]}`}>
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-xl leading-tight font-semibold tabular-nums">{value}</span>
        <span className="block truncate text-xs text-text-dim">{label}</span>
      </span>
    </div>
  )
}

function SectionHeader({
  icon,
  title,
  count,
  hint,
  action,
}: {
  icon: IconName
  title: string
  count: number
  hint?: string
  action?: { to: string; label: string }
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon name={icon} size={17} className="text-text-dim" />
        {title}
      </h2>
      <span className="chip tabular-nums">{count}</span>
      {hint && <span className="hidden text-xs text-text-dim sm:inline">{hint}</span>}
      {action && (
        <Link
          to={action.to}
          className="ml-auto flex items-center gap-1 text-sm text-text-dim hover:text-text"
        >
          {action.label}
          <Icon name="chevronRight" size={15} />
        </Link>
      )}
    </div>
  )
}

function Panel({
  icon,
  title,
  hint,
  action,
  children,
}: {
  icon: IconName
  title: string
  hint?: string
  action?: { to: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className="card p-3">
      <div className="flex items-center gap-2 px-1">
        <Icon name={icon} size={16} className="text-text-dim" />
        <h2 className="text-sm font-semibold">{title}</h2>
        {action && (
          <Link to={action.to} className="ml-auto text-xs text-text-dim hover:text-text">
            {action.label}
          </Link>
        )}
      </div>
      {hint && <p className="mt-0.5 px-1 text-xs text-text-dim">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

function Empty({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="mt-2 card-quiet flex items-center gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink-hover text-text-dim">
        <Icon name={icon} size={19} />
      </span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-text-dim">{body}</span>
      </span>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl">
      <div className="h-14 w-64 animate-shimmer rounded-2xl bg-ink-raised" />
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-16 animate-shimmer rounded-2xl bg-ink-raised" />
        ))}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-20 animate-shimmer rounded-2xl bg-ink-raised" />
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1].map((index) => (
            <div key={index} className="h-32 animate-shimmer rounded-2xl bg-ink-raised" />
          ))}
        </div>
      </div>
    </div>
  )
}
