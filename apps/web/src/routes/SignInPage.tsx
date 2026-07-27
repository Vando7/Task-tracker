import { LIMITS } from '@task-tracker/shared'
import { useState } from 'react'
import { useLogin, useRegister } from '../features/session/api'
import { ApiRequestError } from '../lib/api'

/**
 * Email and password only. No Google button, no OAuth plumbing (section 4.2).
 */
export function SignInPage() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')

  const login = useLogin()
  const register = useRegister()

  const active = mode === 'signin' ? login : register
  const error = active.error instanceof ApiRequestError ? active.error : undefined

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (mode === 'signin') login.mutate({ email, password })
    else register.mutate({ email, password, name })
  }

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4">
      <div className="w-full">
        <h1 className="text-2xl font-semibold">Task Tracker</h1>
        <p className="mt-1 text-text-dim">Chores, organised by the shape of your home.</p>

        {register.isSuccess && mode === 'register' ? (
          <div className="mt-6 rounded-xl border border-done/40 bg-done/10 p-4">
            <p className="font-medium">Check your inbox</p>
            <p className="mt-1 text-sm text-text-dim">
              We sent a confirmation link to <strong className="text-text">{email}</strong>. In
              development it is printed to the server console.
            </p>
            <button
              type="button"
              onClick={() => setMode('signin')}
              className="tap mt-3 rounded-xl border border-edge px-4 text-sm"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            {mode === 'register' && (
              <label className="block text-sm">
                Display name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={64}
                  autoComplete="name"
                  className="tap mt-1 w-full rounded-xl border border-edge bg-ink-raised px-3"
                />
              </label>
            )}

            <label className="block text-sm">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className="tap mt-1 w-full rounded-xl border border-edge bg-ink-raised px-3"
              />
            </label>

            <label className="block text-sm">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === 'register' ? LIMITS.passwordMin : 1}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className="tap mt-1 w-full rounded-xl border border-edge bg-ink-raised px-3"
              />
              {mode === 'register' && (
                <span className="mt-1 block text-xs text-text-dim">
                  At least {LIMITS.passwordMin} characters.
                </span>
              )}
            </label>

            {error && (
              <p role="alert" className="rounded-xl bg-urgent/15 px-3 py-2 text-sm text-urgent">
                {error.message}
              </p>
            )}

            <button
              type="submit"
              disabled={active.isPending}
              className="tap w-full rounded-xl bg-text px-3 font-medium text-ink disabled:opacity-50"
            >
              {active.isPending ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}
              className="tap w-full text-sm text-text-dim hover:text-text"
            >
              {mode === 'signin'
                ? 'No account yet? Create one'
                : 'Already have an account? Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
