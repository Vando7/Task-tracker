import type { Me, Workspace } from '@task-tracker/shared'
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Icon, type IconName } from '../components/Icon'
import { ThemeChoice } from '../components/ThemeToggle'
import { useAddMember, useMembers, useRemoveMember } from '../features/layout/api'
import {
  pushPermission,
  useDisablePush,
  useEnablePush,
  useNotifyPreferences,
  useUpdateNotifyPreferences,
} from '../features/notifications/api'
import { useUpdateProfile, useUploadAvatar } from '../features/session/api'
import { useFairness } from '../features/stats/api'
import { ApiRequestError } from '../lib/api'

export function SettingsPage({ workspace, me }: { workspace: Workspace; me: Me }) {
  return (
    <div className="mx-auto max-w-2xl animate-rise space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <Icon name="sliders" size={19} className="text-text-dim" />
        Settings
      </h1>
      <FairnessPanel workspace={workspace} me={me} />
      <AppearancePanel />
      <MembersPanel workspace={workspace} me={me} />
      <NotificationsPanel />
      <ProfilePanel me={me} />
    </div>
  )
}

function Panel({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: IconName
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="card p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon name={icon} size={17} className="text-text-dim" />
        {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-sm text-text-dim">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * The fairness tally.
 *
 * Deliberately a plain count per person: no points, no streaks, no badges.
 * Gamifying chores between people who live together tends to curdle; an honest
 * tally gives the accountability without keeping score.
 */
function FairnessPanel({ workspace, me }: { workspace: Workspace; me: Me }) {
  const [window, setWindow] = useState<'week' | 'month'>('week')
  const { data } = useFairness(workspace.id, window)

  const most = Math.max(...(data?.rows ?? []).map((row) => row.completions), 1)

  return (
    <Panel
      icon="chart"
      title="Who's been doing it"
      subtitle="Completions from the log. No points, no streaks."
    >
      <div className="mb-3 inline-flex gap-1 rounded-xl border border-edge bg-ink p-1">
        {(['week', 'month'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setWindow(option)}
            aria-pressed={window === option}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              window === option ? 'bg-ink-raised text-text' : 'text-text-dim hover:text-text'
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
            <span className="w-24 shrink-0 truncate text-sm">
              {row.user.id === me.user.id ? 'You' : row.user.name}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-sunken">
              <span
                className="block h-full rounded-full bg-linear-to-r from-done/70 to-done transition-[width] duration-500"
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

/** Light, dark, or follow the device. Stored locally — it is a per-device taste. */
function AppearancePanel() {
  return (
    <Panel icon="sun" title="Appearance" subtitle="Remembered on this device only.">
      <ThemeChoice />
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
    <Panel icon="users" title="Household" subtitle={`${workspace.name} · ${workspace.timezone}`}>
      <ul className="space-y-2">
        {members?.map((member) => (
          <li key={member.user.id} className="flex items-center gap-2">
            <Avatar user={member.user} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{member.user.name}</span>
              <span className="block truncate text-xs text-text-dim">{member.user.email}</span>
            </span>
            {member.role === 'owner' && (
              <span className="chip">
                <Icon name="star" size={12} />
                owner
              </span>
            )}
            {(isOwner || member.user.id === me.user.id) && members.length > 1 && (
              <button
                type="button"
                onClick={() => remove.mutate(member.user.id)}
                className="btn btn-sm btn-quiet-danger"
              >
                <Icon name={member.user.id === me.user.id ? 'logOut' : 'x'} size={14} />
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
          className="mt-4"
        >
          <label className="block text-sm">
            Add someone by email
            <span className="mt-1 flex gap-1.5">
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="housemate@example.com"
                className="field min-w-0 flex-1"
              />
              <button type="submit" disabled={add.isPending} className="btn btn-primary">
                <Icon name="userPlus" size={17} />
                Add
              </button>
            </span>
          </label>
          <p className="mt-1 text-xs text-text-dim">
            They need an account already — emailed invitations aren’t built yet.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-2 flex items-center gap-2 rounded-xl bg-urgent/15 px-3 py-2 text-sm text-urgent"
            >
              <Icon name="alert" size={15} />
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
 * load. If the browser can't do push, or the server has no VAPID
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
    ['onCommented', 'When someone writes a note on a chore I’m involved in'],
  ] as const

  return (
    <Panel
      icon="bell"
      title="Notifications"
      subtitle="In-app always works. Push also reaches you with the tab closed."
    >
      {permission === 'unsupported' ? (
        <p className="flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-sm text-text-dim">
          <Icon name="alert" size={15} />
          This browser can’t do push notifications. The in-app feed still works.
        </p>
      ) : preferences?.enabled ? (
        <button type="button" onClick={() => disable.mutate()} className="btn">
          <Icon name="bell" size={16} />
          Turn off push on this device
        </button>
      ) : (
        <button
          type="button"
          onClick={() => enable.mutate()}
          disabled={enable.isPending}
          className="btn btn-primary"
        >
          <Icon name="bell" size={16} />
          {enable.isPending ? 'Asking…' : 'Turn on push notifications'}
        </button>
      )}

      {pushError && (
        <p
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-xl bg-special/15 px-3 py-2 text-sm text-special"
        >
          <Icon name="alert" size={15} />
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
                className="size-4 accent-accent"
              />
              {label}
            </label>
          </li>
        ))}
      </ul>

      <label className="mt-4 block text-sm">
        <span className="flex items-center gap-1.5">
          <Icon name="clock" size={14} className="text-text-dim" />
          Warn me this many hours ahead
        </span>
        <input
          type="number"
          min={1}
          max={336}
          value={preferences?.dueSoonLeadHours ?? 24}
          onChange={(event) => update.mutate({ dueSoonLeadHours: Number(event.target.value) })}
          className="field mt-1 w-24 text-center"
        />
      </label>

      <fieldset className="mt-4">
        <legend className="flex items-center gap-1.5 text-sm">
          <Icon name="moon" size={14} className="text-text-dim" />
          Quiet hours
        </legend>
        <p className="text-xs text-text-dim">
          Suppresses push only — the in-app feed still updates.
        </p>
        <span className="mt-1.5 flex items-center gap-2 text-sm">
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
            className="field w-auto"
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
            className="field w-auto"
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
    <Panel icon="user" title="You">
      <div className="flex items-center gap-3">
        <Avatar user={me.user} size={48} />
        <label className="text-sm">
          <span className="btn cursor-pointer">
            <Icon name="upload" size={16} />
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
        className="mt-4"
      >
        <label className="block text-sm">
          Display name
          <span className="mt-1 flex gap-1.5">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={64}
              className="field min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={update.isPending || name.trim() === me.user.name}
              className="btn"
            >
              <Icon name="check" size={16} />
              Save
            </button>
          </span>
        </label>
      </form>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-text-dim">
        <Icon name="mail" size={13} />
        {me.user.email}
      </p>
    </Panel>
  )
}
