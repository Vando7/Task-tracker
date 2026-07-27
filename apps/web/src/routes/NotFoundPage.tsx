import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="grid place-items-center p-10 text-center">
      <div>
        <h1 className="text-xl font-semibold">Nothing here</h1>
        <Link to="/" className="tap mt-3 inline-flex rounded-xl border border-edge px-4">
          Go home
        </Link>
      </div>
    </div>
  )
}
