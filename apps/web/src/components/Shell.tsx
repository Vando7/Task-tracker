import type { Me, Workspace } from '@task-tracker/shared'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLayout } from '../features/layout/api'
import { useMarkAllRead, useMarkRead, useNotifications } from '../features/notifications/api'
import { useLogout } from '../features/session/api'
import { relativeTime } from '../lib/format'
import { taskPath } from '../lib/share'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'
import { NewTaskDialog } from './NewTaskDialog'
import { ThemeToggle } from './ThemeToggle'

/**
 * The app shell: header, floor/room tree, new-task affordances, notification bell.
 *
 * The tree is queried live. The legacy sidebar read a denormalised
 * `session["sidebar_floors"]` snapshot written at login, so it rendered
 * differently right after login than after a workspace switch, and the query was
 * duplicated in two places.
 *
 * Phone is the primary target: the nav is a full-screen overlay
 * below `lg`, and the primary action also sits in a thumb-reachable floating
 * button rather than only at the top of a sidebar.
 */
export function Shell({
  me,
  workspace,
  children,
}: {
  me: Me
  workspace: Workspace
  children: ReactNode
}) {
  const [navOpen, setNavOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const location = useLocation()
  const { data: layout } = useLayout(workspace.id)
  const { data: notifications } = useNotifications(workspace.id)
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()
  const logout = useLogout()
  // A `<details>` does not close because something inside it navigated, and this
  // one is a menu: leaving it hanging open over the page you just moved to is the
  // clearest sign the tap did nothing.
  const bellRef = useRef<HTMLDetailsElement>(null)

  const base = `/w/${workspace.id}`
  const unread = notifications?.unreadCount ?? 0
  const closeNav = () => setNavOpen(false)

  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-20 flex items-center gap-2 border-b border-edge px-3 py-2">
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          className="icon-btn lg:hidden"
        >
          <Icon name={navOpen ? 'x' : 'menu'} size={20} />
        </button>

        <Link to={base} className="flex min-w-0 items-center gap-2" onClick={closeNav}>
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-xl bg-linear-to-br from-accent to-info text-white shadow-[0_6px_16px_-8px_var(--color-accent)]"
          >
            <Icon name="home" size={17} strokeWidth={2} />
          </span>
          <span className="min-w-0">
            <span className="block truncate leading-tight font-semibold">{workspace.name}</span>
            <span className="block text-xs leading-tight text-text-dim">
              {workspace.memberCount} in the house
            </span>
          </span>
        </Link>

        <span className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />

          <details ref={bellRef} className="relative">
            <summary className="icon-btn cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <span className="relative">
                <Icon name="bell" size={19} />
                {unread > 0 && (
                  <>
                    {/* The badge is decoration; the count is announced by the
                        sr-only text beside it. `aria-label` on a plain span has no
                        role to attach to and is ignored by screen readers. */}
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-urgent px-1 text-[0.65rem] leading-4 font-semibold text-white"
                    >
                      {unread > 9 ? '9+' : unread}
                    </span>
                    <span className="sr-only">{unread} unread notifications</span>
                  </>
                )}
              </span>
            </summary>
            <div className="card absolute right-0 z-30 mt-2 w-80 max-w-[85vw] p-2">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
                  <Icon name="bell" size={13} />
                  Notifications
                </span>
                {unread > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllRead.mutate()}
                    className="text-xs text-text-dim hover:text-text"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <ul className="max-h-80 overflow-y-auto">
                {(notifications?.notifications ?? []).length === 0 && (
                  <li className="px-1 py-3 text-sm text-text-dim">Nothing yet.</li>
                )}
                {notifications?.notifications.map((item) => (
                  <li key={item.id}>
                    {/*
                      Lands on the task, pinned and open — the same URL push uses,
                      built by the same helper, so there is one shape to get right.
                      Tapping it also reads it and closes the menu: the whole
                      complaint about this feed was that a tap appeared to do
                      nothing, and the badge not moving was half of that.
                    */}
                    <Link
                      to={item.taskId ? taskPath(workspace.id, item.taskId) : base}
                      onClick={() => {
                        if (!item.readAt) markRead.mutate(item.id)
                        if (bellRef.current) bellRef.current.open = false
                        closeNav()
                      }}
                      className={`flex items-start gap-2 rounded-xl px-2 py-2 text-sm hover:bg-ink-hover ${
                        item.readAt ? 'text-text-dim' : 'bg-ink-hover'
                      }`}
                    >
                      <Icon name={KIND_ICON[item.kind] ?? 'bell'} size={15} className="mt-0.5" />
                      <span className="min-w-0">
                        <span className="font-medium">{KIND_LABEL[item.kind]}</span>
                        {item.taskName && <> · {item.taskName}</>}
                        <span className="block text-xs text-text-dim">
                          {relativeTime(item.sentAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>

          <Link
            to={`${base}/settings`}
            className="icon-btn overflow-hidden"
            aria-label="You and your settings"
            onClick={closeNav}
          >
            <Avatar user={me.user} size={24} />
          </Link>
        </span>
      </header>

      <div className="flex">
        {/* Below the lg breakpoint this becomes a full-screen overlay. */}
        <nav
          className={[
            'z-10 w-64 shrink-0 border-r border-edge bg-ink p-3',
            navOpen
              ? 'fixed inset-0 top-15 block overflow-y-auto'
              : 'hidden lg:block lg:sticky lg:top-15 lg:h-[calc(100dvh-3.75rem)] lg:overflow-y-auto',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={() => {
              setComposing(true)
              closeNav()
            }}
            className="btn btn-primary w-full"
          >
            <Icon name="plus" size={18} strokeWidth={2.25} />
            New task
          </button>

          <ul className="mt-3 space-y-0.5">
            <NavItem
              to={base}
              icon="home"
              label="Dashboard"
              active={location.pathname === base}
              onNavigate={closeNav}
            />
            <NavItem
              to={`${base}/house`}
              icon="layers"
              label="The house"
              active={location.pathname === `${base}/house`}
              onNavigate={closeNav}
            />
            <NavItem
              to={`${base}/tasks`}
              icon="list"
              label="All tasks"
              active={location.pathname === `${base}/tasks`}
              onNavigate={closeNav}
            />
            <NavItem
              to={`${base}/settings`}
              icon="sliders"
              label="Settings"
              active={location.pathname === `${base}/settings`}
              onNavigate={closeNav}
            />
          </ul>

          <p className="mt-4 px-2 text-xs font-medium tracking-wide text-text-dim uppercase">
            Floors
          </p>

          <ul className="mt-1.5 space-y-2">
            {layout?.floors.map((floor) => (
              <li
                key={floor.id}
                style={{ '--floor': floor.color } as React.CSSProperties}
                className="floor-tint rounded-xl border p-1"
              >
                <Link
                  to={`${base}/tasks?floorId=${floor.id}`}
                  onClick={closeNav}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm font-medium hover:bg-ink-hover/50"
                >
                  <span aria-hidden="true">{floor.icon}</span>
                  <span className="truncate">{floor.name}</span>
                  {floor.openTaskCount > 0 && (
                    <span className="count-badge ml-auto">{floor.openTaskCount}</span>
                  )}
                </Link>
                <ul className="ml-2.5 border-l border-edge/60 pl-1.5">
                  {floor.rooms.map((room) => (
                    <li key={room.id}>
                      <Link
                        to={`${base}/tasks?roomId=${room.id}`}
                        onClick={closeNav}
                        className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm text-text-dim hover:bg-ink-hover/50 hover:text-text"
                      >
                        <span aria-hidden="true">{room.icon}</span>
                        <span className="truncate">{room.name}</span>
                        {room.openTaskCount > 0 && (
                          <span className="ml-auto text-xs tabular-nums">{room.openTaskCount}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                  {floor.rooms.length === 0 && (
                    <li className="px-1.5 py-1 text-xs text-text-dim italic">no rooms yet</li>
                  )}
                </ul>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-1 border-t border-edge pt-3">
            {me.workspaces.length > 1 && (
              <Link
                to="/workspaces"
                onClick={closeNav}
                className="flex items-center gap-2 rounded-xl px-2 py-2 text-sm text-text-dim hover:bg-ink-hover hover:text-text"
              >
                <Icon name="swap" size={16} />
                Switch household
              </Link>
            )}
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-text-dim hover:bg-ink-hover hover:text-text"
            >
              <Icon name="logOut" size={16} />
              Sign out
            </button>
          </div>
        </nav>

        <main className="min-w-0 flex-1 p-3 pb-28 sm:p-5 lg:pb-10">{children}</main>
      </div>

      {/* Thumb-reachable primary action on a phone; the sidebar covers pointer devices. */}
      <button
        type="button"
        onClick={() => setComposing(true)}
        aria-label="New task"
        className="btn btn-primary fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-(--shadow-float) lg:hidden"
      >
        <Icon name="plus" size={24} strokeWidth={2.25} />
      </button>

      {composing && <NewTaskDialog workspace={workspace} onClose={() => setComposing(false)} />}
    </div>
  )
}

function NavItem({
  to,
  icon,
  label,
  active,
  onNavigate,
}: {
  to: string
  icon: IconName
  label: string
  active: boolean
  onNavigate: () => void
}) {
  return (
    <li>
      <Link
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={[
          'flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm transition-colors',
          active
            ? 'bg-ink-hover font-medium text-text'
            : 'text-text-dim hover:bg-ink-hover hover:text-text',
        ].join(' ')}
      >
        <Icon name={icon} size={17} />
        {label}
      </Link>
    </li>
  )
}

const KIND_LABEL: Record<string, string> = {
  assigned: 'Assigned to you',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  completed_by_other: 'Done by someone else',
  commented: 'New note',
}

const KIND_ICON: Record<string, IconName> = {
  assigned: 'userPlus',
  due_soon: 'clock',
  overdue: 'alert',
  completed_by_other: 'checkCircle',
  commented: 'comment',
}
