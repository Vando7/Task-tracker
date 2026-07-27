import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'

export function NotFoundPage() {
  return (
    <div className="grid place-items-center p-10 text-center">
      <div className="animate-rise">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-ink-hover text-text-dim">
          <Icon name="search" size={24} />
        </span>
        <h1 className="mt-3 text-xl font-semibold">Nothing here</h1>
        <p className="mt-1 text-text-dim">That page doesn’t exist — or it moved.</p>
        <Link to="/" className="btn mx-auto mt-4">
          <Icon name="home" size={16} />
          Go home
        </Link>
      </div>
    </div>
  )
}
