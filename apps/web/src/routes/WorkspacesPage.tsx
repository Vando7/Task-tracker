import type { Me } from '@task-tracker/shared'
import { useState } from 'react'
import { Link } from 'react-router-dom'
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
    <div className="mx-auto max-w-md p-4">
      <h1 className="text-xl font-semibold">
        {empty ? 'Set up your household' : 'Your households'}
      </h1>
      {empty && (
        <p className="mt-1 text-text-dim">
          A household is a home you share. You can invite the people you live with once it exists.
        </p>
      )}

      {!empty && (
        <ul className="mt-4 space-y-2">
          {me.workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                to={`/w/${workspace.id}`}
                className="flex items-center gap-2 rounded-xl border border-edge bg-ink-raised p-3 hover:bg-ink-hover"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{workspace.name}</span>
                  <span className="block text-xs text-text-dim">
                    {workspace.memberCount} member{workspace.memberCount === 1 ? '' : 's'} ·{' '}
                    {workspace.timezone} · {workspace.role}
                  </span>
                </span>
                <span aria-hidden="true" className="text-text-dim">
                  →
                </span>
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
        className="mt-4 rounded-xl border border-edge bg-ink-raised p-3"
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
            className="tap mt-1 w-full rounded-xl border border-edge bg-ink px-3"
          />
        </label>
        <p className="mt-1 text-xs text-text-dim">Timezone: {timezone}</p>

        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-urgent/15 px-2 py-1 text-sm text-urgent">
            {error.message}
          </p>
        )}

        <button
          type="submit"
          disabled={create.isPending || name.trim().length === 0}
          className="tap mt-2 w-full rounded-xl bg-text px-3 font-medium text-ink disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => logout.mutate()}
        className="tap mt-4 w-full rounded-xl border border-edge px-3 text-sm text-text-dim"
      >
        Sign out
      </button>
    </div>
  )
}
