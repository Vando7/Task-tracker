/**
 * Relative time, and the one thing the legacy client got badly wrong.
 *
 * `overdue` arrives from the server as a boolean, computed against the workspace
 * timezone. It is never re-derived here — the legacy client decided it by
 * checking whether a formatted string contained the substring "ago", which is
 * how a task due in "2 hours ago minutes" ends up mislabelled.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "in 3 days", "2 hours ago", "just now". */
export function relativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''

  const target = new Date(iso).getTime()
  const diff = target - now
  const magnitude = Math.abs(diff)

  if (magnitude < MINUTE) return 'just now'

  const [value, unit] =
    magnitude < HOUR
      ? [Math.round(magnitude / MINUTE), 'minute' as const]
      : magnitude < DAY
        ? [Math.round(magnitude / HOUR), 'hour' as const]
        : magnitude < 30 * DAY
          ? [Math.round(magnitude / DAY), 'day' as const]
          : [Math.round(magnitude / (30 * DAY)), 'month' as const]

  const plural = value === 1 ? unit : `${unit}s`
  return diff > 0 ? `in ${value} ${plural}` : `${value} ${plural} ago`
}

/** "last done 3 days ago" — from the completion log, not from `modified_date`. */
export function lastDoneLabel(lastCompletedAt: string | null): string {
  if (!lastCompletedAt) return 'never done'
  return `last done ${relativeTime(lastCompletedAt)}`
}

export function stalenessLabel(days: number | null): string {
  if (days === null) return 'nothing done yet'
  if (days === 0) return 'something done today'
  if (days === 1) return 'nothing done since yesterday'
  return `nothing done in ${days} days`
}

/**
 * The same fact, compact enough to sit beside a room name without either one
 * truncating. The full sentence goes in the `title`.
 */
export function stalenessShort(days: number | null): string {
  if (days === null) return 'never'
  if (days === 0) return 'today'
  return `${days}d`
}

/**
 * Calendar day in the workspace timezone, as `YYYY-MM-DD`.
 *
 * "Due today" is a household-wide question, so it is answered in the household's
 * zone rather than the browser's — one home, one notion of today. Mirrors
 * `calendarDayInZone` on the server.
 */
export function calendarDayIn(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function isDueToday(
  dueDate: string | null,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!dueDate) return false
  return calendarDayIn(dueDate, timeZone) === calendarDayIn(now, timeZone)
}

/** "Friday, 27 July" in the household's zone. */
export function longDateIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)
}

/** "Good morning" / "Good afternoon" / "Good evening", by the household's clock. */
export function greetingIn(timeZone: string, now: Date = new Date()): string {
  const hour =
    Number(
      new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(now),
      // `hour12: false` renders midnight as 24 in some engines.
    ) % 24
  if (hour < 5) return 'Still up'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function formatDateTimeLocal(iso: string | null): string {
  if (!iso) return ''
  // `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone.
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Turn a `datetime-local` value into an absolute instant with the browser's offset. */
export function localInputToIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

/** Deterministic hue from a user id, so an initials avatar is stable per person. */
export function avatarHue(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 360
  }
  return hash
}

export function recurrenceLabel(every: number | null, unit: string | null): string {
  if (!every || !unit) return 'one-off'
  return every === 1 ? `every ${unit}` : `every ${every} ${unit}s`
}
