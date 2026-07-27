import { LIMITS } from '@task-tracker/shared'
import { useState } from 'react'
import { Icon } from '../components/Icon'
import { ThemeToggle } from '../components/ThemeToggle'
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
      <div className="w-full animate-rise">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-accent to-info text-white shadow-(--shadow-float)"
          >
            <Icon name="home" size={24} strokeWidth={2} />
          </span>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Task Tracker</h1>
            <p className="text-text-dim">Chores, organised by the shape of your home.</p>
          </div>
          <ThemeToggle />
        </div>

        {register.isSuccess && mode === 'register' && register.data?.verificationRequired ? (
          <div className="card mt-6 p-4">
            <p className="flex items-center gap-2 font-medium">
              <Icon name="mail" size={17} className="text-done" />
              Check your inbox
            </p>
            <p className="mt-1 text-sm text-text-dim">
              We sent a confirmation link to <strong className="text-text">{email}</strong>. In
              development it is printed to the server console.
            </p>
            <button type="button" onClick={() => setMode('signin')} className="btn btn-sm mt-3">
              <Icon name="arrowRight" size={14} />
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="card mt-6 space-y-3 p-4">
            {mode === 'register' && (
              <label className="block text-sm">
                <span className="flex items-center gap-1.5">
                  <Icon name="user" size={14} className="text-text-dim" />
                  Display name
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={64}
                  autoComplete="name"
                  className="field mt-1"
                />
              </label>
            )}

            <label className="block text-sm">
              <span className="flex items-center gap-1.5">
                <Icon name="mail" size={14} className="text-text-dim" />
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className="field mt-1"
              />
            </label>

            <label className="block text-sm">
              <span className="flex items-center gap-1.5">
                <Icon name="lock" size={14} className="text-text-dim" />
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={mode === 'register' ? LIMITS.passwordMin : 1}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className="field mt-1"
              />
              {mode === 'register' && (
                <span className="mt-1 block text-xs text-text-dim">
                  At least {LIMITS.passwordMin} characters.
                </span>
              )}
            </label>

            {error && (
              <p
                role="alert"
                className="flex items-center gap-2 rounded-xl bg-urgent/15 px-3 py-2 text-sm text-urgent"
              >
                <Icon name="alert" size={16} />
                {error.message}
              </p>
            )}

            <button type="submit" disabled={active.isPending} className="btn btn-primary w-full">
              <Icon name={mode === 'signin' ? 'logIn' : 'userPlus'} size={17} />
              {active.isPending ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            <button
              type="button"
              onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}
              className="btn btn-ghost w-full"
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
