import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { useVerifyEmail } from '../features/session/api'

/** Landing page for the link in the verification email. */
export function VerifyPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const verify = useVerifyEmail()

  useEffect(() => {
    if (token && verify.isIdle) verify.mutate(token)
  }, [token, verify])

  return (
    <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-4 text-center">
      <div className="card w-full animate-rise p-6">
        {!token && <p className="text-text-dim">This link is missing its token.</p>}

        {verify.isPending && (
          <p className="flex items-center justify-center gap-2 text-text-dim">
            <span className="size-2 animate-shimmer rounded-full bg-accent" />
            Confirming…
          </p>
        )}

        {verify.isSuccess && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-done/15 text-done">
              <Icon name="checkCircle" size={24} />
            </span>
            <h1 className="mt-3 text-xl font-semibold">Address confirmed</h1>
            <Link to="/" className="btn btn-primary mx-auto mt-4">
              <Icon name="arrowRight" size={17} />
              Continue
            </Link>
          </>
        )}

        {verify.isError && (
          <>
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-urgent/15 text-urgent">
              <Icon name="alert" size={24} />
            </span>
            <h1 className="mt-3 text-xl font-semibold">That link didn’t work</h1>
            <p className="mt-1 text-text-dim">
              It may have expired or already been used. Signing in again will send a fresh one.
            </p>
            <Link to="/" className="btn mx-auto mt-4">
              Back
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
