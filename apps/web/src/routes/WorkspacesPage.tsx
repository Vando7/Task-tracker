import type { Me } from '@task-tracker/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ThemeToggle } from '../components/ThemeToggle'
import { useCreateWorkspace } from '../features/layout/api'
import { useLogout } from '../features/session/api'
import { ApiRequestError } from '../lib/api'

/**
 * Real workspace CRUD, which the legacy app never had: a workspace could only
 * come into being by being auto-created on login, and could never be renamed or
 * deleted (Part 2, gap 31).
 *
 * An empty list is also handled properly here rather than crashing, which is
 * what the legacy index view did on a fresh or cleared session (problem 10).
 */
export function WorkspacesPage({ me }: { me: Me }) {
  const [name, setName] = useState('')
  const create = useCreateWorkspace()
  const logout = useLogout()

  // Best guess at the household's timezone, editable in settings afterwards.
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const error = create.error instanceof ApiRequestError ? create.error : undefined
  const empty = me.workspaces.length === 0

  return (
    <div className="mx-auto max-w-md animate-rise p-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Icon name="home" size={19} className="text-text-dim" />
            {empty ? 'Set up your household' : 'Your households'}
          </h1>
          {empty && (
            <p className="mt-1 text-text-dim">
              A household is a home you share. You can invite the people you live with once it
              exists.
            </p>
          )}
        </div>
        <ThemeToggle />
      </div>

      {!empty && (
        <ul className="mt-4 space-y-2">
          {me.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to={`/w/${workspace.id}`}
                className="card hover-lift flex items-center gap-3 p-3"
              >
                <span
                  aria-hidden="true"
                  className="flex size-10 items-center justify-center rounded-xl bg-accent/15 text-accent-soft"
                >
                  <Icon name="home" size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{workspace.name}</span>
                  <span className="block text-xs text-text-dim">
                    {workspace.memberCount} member{workspace.memberCount === 1 ? '' : 's'} ·{' '}
                    {workspace.timezone} · {workspace.role}
                  </span>
                </span>
                <Icon name="chevronRight" size={18} className="text-text-dim" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate({ name: name.trim(), timezone }, { onSuccess: () => setName('') })
        }}
        className="card mt-4 p-3"
      >
        <label className="block text-sm">
          {empty ? 'Name your household' : 'Add another household'}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={64}
            placeholder="Flat 4B"
            // biome-ignore lint/a11y/noAutofocus: first-run setup: the only field on the page
            autoFocus={empty}
            className="field mt-1"
          />
        </label>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-dim">
          <Icon name="clock" size={12} />
          Timezone: {timezone}
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

        <button
          type="submit"
          disabled={create.isPending || name.trim().length === 0}
          className="btn btn-primary mt-3 w-full"
        >
          <Icon name="plus" size={17} />
          {create.isPending ? 'Creating…' : 'Create household'}
        </button>
      </form>

      <button type="button" onClick={() => logout.mutate()} className="btn btn-ghost mt-4 w-full">
        <Icon name="logOut" size={16} />
        Sign out
      </button>
    </div>
  )
}
