import type { Me, Workspace } from '@task-tracker/shared'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useLayout } from '../features/layout/api'
import { useMarkAllRead, useNotifications } from '../features/notifications/api'
import { useLogout } from '../features/session/api'
import { relativeTime } from '../lib/format'
import { Avatar } from './Avatar'
import { NewTaskDialog } from './NewTaskDialog'

/**
 * The app shell: floor/room tree, new-task button, notification bell.
 *
 * The tree is queried live. The legacy sidebar read a denormalised
 * `session["sidebar_floors"]` snapshot written at login, so it rendered
 * differently right after login than after a workspace switch, and the query was
 * duplicated in two places (Part 2, problem 17).
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
  const markAllRead = useMarkAllRead()
  const logout = useLogout()

  const base = `/w/${workspace.id}`
  const unread = notifications?.unreadCount ?? 0

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-edge bg-ink/95 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-label="Toggle navigation"
          className="tap rounded-lg border border-edge px-2 lg:hidden"
        >
          ☰
        </button>

        <Link to={base} className="truncate font-semibold">
          {workspace.name}
        </Link>

        <span className="ml-auto flex items-center gap-1">
          <details className="relative">
            <summary className="tap flex cursor-pointer list-none items-center justify-center rounded-lg border border-edge px-2">
              <span aria-hidden="true">🔔</span>
              {unread > 0 && (
                <>
                  {/* The badge is decoration; the count is announced by the
                      sr-only text beside it. `aria-label` on a plain span has no
                      role to attach to and is ignored by screen readers. */}
                  <span
                    aria-hidden="true"
                    className="ml-1 rounded-full bg-urgent px-1.5 text-xs font-semibold text-white"
                  >
                    {unread}
                  </span>
                  <span className="sr-only">{unread} unread notifications</span>
                </>
              )}
            </summary>
            <div className="absolute right-0 z-30 mt-1 w-80 max-w-[85vw] rounded-xl border border-edge bg-ink-raised p-2 shadow-xl">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs font-medium text-text-dim">Notifications</span>
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
                  <li
                    key={item.id}
                    className={`rounded-lg px-2 py-1.5 text-sm ${item.readAt ? 'text-text-dim' : 'bg-ink-hover'}`}
                  >
                    <span className="font-medium">{KIND_LABEL[item.kind]}</span>
                    {item.taskName && <> · {item.taskName}</>}
                    <span className="block text-xs text-text-dim">{relativeTime(item.sentAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>

          <Link
            to={`${base}/settings`}
            className="tap flex items-center justify-center rounded-lg border border-edge px-2"
            aria-label="Settings"
          >
            <Avatar user={{ ...me.user }} size={22} />
          </Link>
        </span>
      </header>

      <div className="flex">
        {/* Below the lg breakpoint this becomes a full-screen overlay. */}
        <nav
          className={[
            'z-10 w-64 shrink-0 border-r border-edge bg-ink p-3',
            navOpen
              ? 'fixed inset-0 top-[3.25rem] block overflow-y-auto'
              : 'hidden lg:block lg:sticky lg:top-[3.25rem] lg:h-[calc(100dvh-3.25rem)] lg:overflow-y-auto',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="tap mb-3 w-full rounded-xl bg-text px-3 font-medium text-ink hover:opacity-90"
          >
            + New task
          </button>

          <Link
            to={base}
            onClick={() => setNavOpen(false)}
            className={`block rounded-lg px-2 py-1.5 text-sm ${location.pathname === base ? 'bg-ink-hover' : 'hover:bg-ink-hover'}`}
          >
            🏠 Home
          </Link>

          <ul className="mt-2 space-y-2">
            {layout?.floors.map((floor) => (
              <li
                key={floor.id}
                style={{ '--floor': floor.color } as React.CSSProperties}
                className="rounded-lg p-1 floor-tint border"
              >
                <Link
                  to={`${base}/tasks?floorId=${floor.id}`}
                  onClick={() => setNavOpen(false)}
                  className="flex items-center gap-1.5 rounded px-1 py-1 text-sm font-medium hover:bg-white/5"
                >
                  <span aria-hidden="true">{floor.icon}</span>
                  <span className="truncate">{floor.name}</span>
                  {floor.openTaskCount > 0 && (
                    <span className="ml-auto text-xs text-text-dim">{floor.openTaskCount}</span>
                  )}
                </Link>
                <ul className="ml-3">
                  {floor.rooms.map((room) => (
                    <li key={room.id}>
                      <Link
                        to={`${base}/tasks?roomId=${room.id}`}
                        onClick={() => setNavOpen(false)}
                        className="flex items-center gap-1.5 rounded px-1 py-1 text-sm text-text-dim hover:bg-white/5 hover:text-text"
                      >
                        <span aria-hidden="true">{room.icon}</span>
                        <span className="truncate">{room.name}</span>
                        {room.openTaskCount > 0 && (
                          <span className="ml-auto text-xs">{room.openTaskCount}</span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => logout.mutate()}
            className="tap mt-4 w-full rounded-lg border border-edge px-2 text-sm text-text-dim hover:bg-ink-hover"
          >
            Sign out
          </button>
        </nav>

        <main className="min-w-0 flex-1 p-3 pb-24 sm:p-5">{children}</main>
      </div>

      {composing && <NewTaskDialog workspace={workspace} onClose={() => setComposing(false)} />}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  assigned: 'Assigned to you',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  completed_by_other: 'Done by someone else',
}
