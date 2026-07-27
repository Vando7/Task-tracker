import type { PublicUser } from '@task-tracker/shared'
import { avatarHue, initials } from '../lib/format'

/**
 * An avatar always renders something.
 *
 * `avatarPath` being null is the normal case now that the Google profile-picture
 * import is gone with OAuth, so the initials fallback is the
 * default path rather than an error state.
 */
export function Avatar({
  user,
  size = 28,
  title,
}: {
  user: PublicUser
  size?: number
  title?: string
}) {
  const label = title ?? user.name

  if (user.avatarPath) {
    return (
      <img
        src={user.avatarPath}
        alt={label}
        title={label}
        width={size}
        height={size}
        className="rounded-full object-cover ring-1 ring-edge"
        style={{ width: size, height: size }}
      />
    )
  }

  const hue = avatarHue(user.id)
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className="inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-edge/60"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `oklch(0.45 0.09 ${hue})`,
        color: 'white',
      }}
    >
      {initials(user.name)}
    </span>
  )
}

/**
 * The assignee row on a card. An empty list is a real, valid state — "whoever
 * gets to it" — so it renders as words, never as an empty slot demanding to be
 * filled.
 */
export function AssigneeStack({ users, size = 24 }: { users: PublicUser[]; size?: number }) {
  if (users.length === 0) {
    return <span className="text-xs text-text-dim italic">anyone</span>
  }

  return (
    <span className="flex items-center -space-x-1.5">
      {users.slice(0, 4).map((user) => (
        <Avatar key={user.id} user={user} size={size} />
      ))}
      {users.length > 4 && (
        <span className="pl-2.5 text-xs text-text-dim">+{users.length - 4}</span>
      )}
    </span>
  )
}
