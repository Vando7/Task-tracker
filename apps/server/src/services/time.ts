/**
 * Timezone arithmetic, using only `Intl` — no date library.
 *
 * A note on what the workspace timezone is and isn't for. "Overdue" is a plain
 * instant comparison (`dueDate < now`), because both sides are absolute points
 * in time and no zone can change their order. The legacy app got this wrong in
 * two directions at once: it stored naive local midnight coerced to UTC, and
 * then decided overdue in the browser by testing whether a formatted string
 * contained the substring "ago".
 *
 * The timezone is load-bearing for the things that genuinely depend on a
 * calendar: "due today", quiet hours, the fairness window, and stepping a
 * recurrence so that "every 2 weeks at 09:00" stays at 09:00 across a DST
 * boundary.
 */

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/** Wall-clock fields as they read in `timeZone` at this instant. */
export function partsInZone(date: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)
    return found ? Number(found.value) : 0
  }
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** How far `timeZone` is ahead of UTC at this instant, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = partsInZone(date, timeZone)
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  return asIfUtc - date.getTime()
}

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * Turn wall-clock fields in `timeZone` into an absolute instant.
 *
 * Two passes: guess using the offset at the naive timestamp, then re-check with
 * the offset at the corrected one. That second pass is what makes DST
 * transitions come out right instead of an hour off twice a year.
 */
export function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )
  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone)
  const corrected = naive - zoneOffsetMs(new Date(firstGuess), timeZone)
  return new Date(corrected)
}

/** `YYYY-MM-DD` as it reads in the zone. Used for day grouping and cycle keys. */
export function calendarDayInZone(date: Date, timeZone: string): string {
  const { year, month, day } = partsInZone(date, timeZone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function startOfDayInZone(date: Date, timeZone: string): Date {
  const { year, month, day } = partsInZone(date, timeZone)
  return zonedTimeToUtc({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone)
}

export function endOfDayInZone(date: Date, timeZone: string): Date {
  const { year, month, day } = partsInZone(date, timeZone)
  return zonedTimeToUtc({ year, month, day, hour: 23, minute: 59, second: 59 }, timeZone)
}

/**
 * Overdue is an instant comparison and needs no zone. Kept as a named function
 * so there is exactly one definition of it in the codebase.
 */
export function isOverdue(dueDate: Date | null, now: Date = new Date()): boolean {
  if (!dueDate) return false
  return dueDate.getTime() < now.getTime()
}

export function isDueToday(
  dueDate: Date | null,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!dueDate) return false
  return calendarDayInZone(dueDate, timeZone) === calendarDayInZone(now, timeZone)
}

/** Add a calendar interval, evaluated in the zone so wall-clock time is preserved. */
export function addInterval(
  date: Date,
  every: number,
  unit: 'day' | 'week' | 'month',
  timeZone: string,
): Date {
  const parts = partsInZone(date, timeZone)

  if (unit === 'day' || unit === 'week') {
    const days = unit === 'week' ? every * 7 : every
    // Date.UTC normalises day overflow into the following month for us.
    return zonedTimeToUtc({ ...parts, day: parts.day + days }, timeZone)
  }

  // Months: clamp the day so 31 January + 1 month is 28/29 February rather than
  // overflowing into March.
  const targetMonthIndex = parts.month - 1 + every
  const year = parts.year + Math.floor(targetMonthIndex / 12)
  const month = (((targetMonthIndex % 12) + 12) % 12) + 1
  const day = Math.min(parts.day, daysInMonth(year, month))
  return zonedTimeToUtc({ ...parts, year, month, day }, timeZone)
}

/** Minutes since midnight in the zone, for quiet-hours comparisons. */
export function minutesOfDayInZone(date: Date, timeZone: string): number {
  const { hour, minute } = partsInZone(date, timeZone)
  return hour * 60 + minute
}

const parseClock = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match?.[1] || !match[2]) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Quiet hours, correct across midnight: `22:00`–`07:00` is a range that wraps,
 * and treating it as `from <= now <= to` would make it match nothing.
 */
export function isWithinQuietHours(
  quietFrom: string | null,
  quietTo: string | null,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  if (!quietFrom || !quietTo) return false

  const from = parseClock(quietFrom)
  const to = parseClock(quietTo)
  if (from === null || to === null) return false
  if (from === to) return false

  const current = minutesOfDayInZone(now, timeZone)
  return from < to ? current >= from && current < to : current >= from || current < to
}

/** Inclusive start of the fairness window, aligned to a day boundary in the zone. */
export function startOfWindow(
  window: 'week' | 'month',
  timeZone: string,
  now: Date = new Date(),
): Date {
  const days = window === 'week' ? 7 : 30
  const parts = partsInZone(now, timeZone)
  return zonedTimeToUtc(
    { ...parts, day: parts.day - days + 1, hour: 0, minute: 0, second: 0 },
    timeZone,
  )
}
