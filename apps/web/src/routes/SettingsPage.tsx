import { useQuery } from '@tanstack/react-query'
import type { Fairness, Me, Workspace } from '@task-tracker/shared'
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { useAddMember, useMembers, useRemoveMember } from '../features/layout/api'
import {
  pushPermission,
  useDisablePush,
  useEnablePush,
  useNotifyPreferences,
  useUpdateNotifyPreferences,
} from '../features/notifications/api'
import { useUpdateProfile, useUploadAvatar } from '../features/session/api'
import { ApiRequestError, api } from '../lib/api'
import { keys } from '../lib/keys'

export function SettingsPage({ workspace, me }: { workspace: Workspace; me: Me }) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <FairnessPanel workspace={workspace} />
      <MembersPanel workspace={workspace} me={me} />
      <NotificationsPanel />
      <ProfilePanel me={me} />
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-edge bg-ink-raised p-4">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-text-dim">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * The fairness tally (section 5.3).
 *
 * Deliberately a plain count per person: no points, no streaks, no badges.
 * Gamifying chores between people who live together tends to curdle; an honest
 * tally gives the accountability without keeping score.
 */
function FairnessPanel({ workspace }: { workspace: Workspace }) {
  const [window, setWindow] = useState<'week' | 'month'>('week')
  const { data } = useQuery({
    queryKey: keys.fairness(workspace.id, window),
    queryFn: () => api<Fairness>(`/api/workspaces/${workspace.id}/stats/fairness?window=${window}`),
  })

  const most = Math.max(1, ...(data?.rows ?? []).map((row) => row.completions))

  return (
    <Panel title="Who's been doing it" subtitle="Completions from the log. No points, no streaks.">
      <div className="mb-3 flex gap-1">
        {(['week', 'month'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setWindow(option)}
            aria-pressed={window === option}
            className={`tap rounded-lg border px-3 text-sm ${
              window === option ? 'border-transparent bg-ink-hover' : 'border-edge text-text-dim'
            }`}
          >
            Last {option}
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {data?.rows.map((row) => (
          <li key={row.user.id} className="flex items-center gap-2">
            <Avatar user={row.user} size={26} />
            <span className="w-24 shrink-0 truncate text-sm">{row.user.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink">
              <span
                className="block h-full rounded-full bg-done/70"
                style={{ width: `${(row.completions / most) * 100}%` }}
              />
            </span>
            <span className="w-8 text-right text-sm tabular-nums">{row.completions}</span>
          </li>
        ))}
      </ul>
      {data?.total === 0 && (
        <p className="text-sm text-text-dim">Nothing completed in this window yet.</p>
      )}
    </Panel>
  )
}

function MembersPanel({ workspace, me }: { workspace: Workspace; me: Me }) {
  const { data: members } = useMembers(workspace.id)
  const add = useAddMember(workspace.id)
  const remove = useRemoveMember(workspace.id)
  const [email, setEmail] = useState('')

  const error = add.error instanceof ApiRequestError ? add.error : undefined
  const isOwner = workspace.role === 'owner'

  return (
    <Panel title="Household" subtitle={`${workspace.name} · ${workspace.timezone}`}>
      <ul className="space-y-2">
        {members?.map((member) => (
          <li key={member.user.id} className="flex items-center gap-2">
            <Avatar user={member.user} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{member.user.name}</span>
              <span className="block truncate text-xs text-text-dim">{member.user.email}</span>
            </span>
            {member.role === 'owner' && (
              <span className="rounded-full bg-ink px-2 text-xs text-text-dim">owner</span>
            )}
            {(isOwner || member.user.id === me.user.id) && members.length > 1 && (
              <button
                type="button"
                onClick={() => remove.mutate(member.user.id)}
                className="tap rounded-lg border border-edge px-2 text-xs text-text-dim hover:text-urgent"
              >
                {member.user.id === me.user.id ? 'Leave' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            add.mutate(email.trim(), { onSuccess: () => setEmail('') })
          }}
          className="mt-3"
        >
          <label className="block text-sm">
            Add someone by email
            <span className="mt-1 flex gap-1">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="housemate@example.com"
                className="tap min-w-0 flex-1 rounded-xl border border-edge bg-ink px-3"
              />
              <button
                type="submit"
                disabled={add.isPending}
                className="tap rounded-xl bg-text px-4 font-medium text-ink disabled:opacity-50"
              >
                Add
              </button>
            </span>
          </label>
          <p className="mt-1 text-xs text-text-dim">
            They need an account already — emailed invitations aren’t built yet.
          </p>
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-urgent/15 px-2 py-1 text-sm text-urgent">
              {error.message}
            </p>
          )}
        </form>
      )}
    </Panel>
  )
}

/**
 * Push permission is requested here, when the user turns it on — never on page
 * load (section 4.3). If the browser can't do push, or the server has no VAPID
 * keys, this degrades to the in-app feed and says so.
 */
function NotificationsPanel() {
  const { data: preferences } = useNotifyPreferences()
  const update = useUpdateNotifyPreferences()
  const enable = useEnablePush()
  const disable = useDisablePush()

  const permission = pushPermission()
  const pushError = enable.error instanceof Error ? enable.error : undefined

  const toggles = [
    ['onAssigned', 'When a chore is assigned to me'],
    ['onDueSoon', 'When something is due soon'],
    ['onOverdue', 'When something goes overdue'],
    ['onCompletedByOther', 'When someone else finishes my chore'],
  ] as const

  return (
    <Panel
      title="Notifications"
      subtitle="In-app always works. Push also reaches you with the tab closed."
    >
      {permission === 'unsupported' ? (
        <p className="rounded-lg bg-ink px-3 py-2 text-sm text-text-dim">
          This browser can’t do push notifications. The in-app feed still works.
        </p>
      ) : preferences?.enabled ? (
        <button
          type="button"
          onClick={() => disable.mutate()}
          className="tap rounded-xl border border-edge px-4 text-sm"
        >
          Turn off push on this device
        </button>
      ) : (
        <button
          type="button"
          onClick={() => enable.mutate()}
          disabled={enable.isPending}
          className="tap rounded-xl bg-text px-4 font-medium text-ink disabled:opacity-50"
        >
          {enable.isPending ? 'Asking…' : 'Turn on push notifications'}
        </button>
      )}

      {pushError && (
        <p role="alert" className="mt-2 rounded-lg bg-special/15 px-2 py-1 text-sm text-special">
          {pushError.message} — the in-app feed is unaffected.
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {toggles.map(([key, label]) => (
          <li key={key}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={preferences?.[key] ?? true}
                onChange={(event) => update.mutate({ [key]: event.target.checked })}
                className="size-4"
              />
              {label}
            </label>
          </li>
        ))}
      </ul>

      <label className="mt-3 block text-sm">
        Warn me this many hours ahead
        <input
          type="number"
          min={1}
          max={336}
          value={preferences?.dueSoonLeadHours ?? 24}
          onChange={(event) => update.mutate({ dueSoonLeadHours: Number(event.target.value) })}
          className="tap mt-1 w-24 rounded-xl border border-edge bg-ink px-3"
        />
      </label>

      <fieldset className="mt-3">
        <legend className="text-sm">Quiet hours</legend>
        <p className="text-xs text-text-dim">
          Suppresses push only — the in-app feed still updates.
        </p>
        <span className="mt-1 flex items-center gap-2 text-sm">
          <input
            type="time"
            value={preferences?.quietFrom ?? ''}
            aria-label="Quiet hours start"
            onChange={(event) =>
              update.mutate({
                quietFrom: event.target.value || null,
                quietTo: preferences?.quietTo ?? '07:00',
              })
            }
            className="tap rounded-xl border border-edge bg-ink px-2"
          />
          <span className="text-text-dim">to</span>
          <input
            type="time"
            value={preferences?.quietTo ?? ''}
            aria-label="Quiet hours end"
            onChange={(event) =>
              update.mutate({
                quietFrom: preferences?.quietFrom ?? '22:00',
                quietTo: event.target.value || null,
              })
            }
            className="tap rounded-xl border border-edge bg-ink px-2"
          />
        </span>
      </fieldset>
    </Panel>
  )
}

function ProfilePanel({ me }: { me: Me }) {
  const [name, setName] = useState(me.user.name)
  const update = useUpdateProfile()
  const upload = useUploadAvatar()

  return (
    <Panel title="You">
      <div className="flex items-center gap-3">
        <Avatar user={me.user} size={48} />
        <label className="text-sm">
          <span className="tap inline-flex cursor-pointer items-center rounded-xl border border-edge px-3">
            {upload.isPending ? 'Uploading…' : 'Change avatar'}
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) upload.mutate(file)
            }}
          />
        </label>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          update.mutate({ name: name.trim() })
        }}
        className="mt-3"
      >
        <label className="block text-sm">
          Display name
          <span className="mt-1 flex gap-1">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={64}
              className="tap min-w-0 flex-1 rounded-xl border border-edge bg-ink px-3"
            />
            <button
              type="submit"
              disabled={update.isPending || name.trim() === me.user.name}
              className="tap rounded-xl border border-edge px-4 text-sm disabled:opacity-40"
            >
              Save
            </button>
          </span>
        </label>
      </form>
      <p className="mt-2 text-xs text-text-dim">{me.user.email}</p>
    </Panel>
  )
}
