import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
      <div>
        {!token && <p className="text-text-dim">This link is missing its token.</p>}
        {verify.isPending && <p className="animate-pulse text-text-dim">Confirming…</p>}
        {verify.isSuccess && (
          <>
            <h1 className="text-xl font-semibold">Address confirmed</h1>
            <Link
              to="/"
              className="tap mt-3 inline-flex rounded-xl bg-text px-4 font-medium text-ink"
            >
              Continue
            </Link>
          </>
        )}
        {verify.isError && (
          <>
            <h1 className="text-xl font-semibold">That link didn’t work</h1>
            <p className="mt-1 text-text-dim">
              It may have expired or already been used. Signing in again will send a fresh one.
            </p>
            <Link to="/" className="tap mt-3 inline-flex rounded-xl border border-edge px-4">
              Back
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
