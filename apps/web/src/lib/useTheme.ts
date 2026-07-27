import { useSyncExternalStore } from 'react'

/**
 * Light/dark, with the system preference as the starting point.
 *
 * Three states, not two: `system` is the default and keeps following the OS, so a
 * phone that flips to dark at sunset takes the app with it. Choosing light or dark
 * explicitly pins it and persists.
 *
 * Deliberately a module-level store rather than per-component state: the header
 * toggle and the Settings selector are two views of one setting, and with
 * `useState` in each they would disagree the moment either one was used. The
 * applied theme lives in the DOM as `data-theme` on `<html>`, which is what the
 * CSS keys off; `index.html` stamps it before React mounts, so there is no
 * first-paint flash.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'tt-theme'
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f3f6fb', dark: '#0a0e14' }

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Private mode, or storage disabled. The default is fine.
  }
  return 'system'
}

const lightMedia = (): MediaQueryList => window.matchMedia('(prefers-color-scheme: light)')

const resolve = (preference: ThemePreference): ResolvedTheme =>
  preference === 'system' ? (lightMedia().matches ? 'light' : 'dark') : preference

type Snapshot = { preference: ThemePreference; resolved: ResolvedTheme }

const initial = readPreference()
let snapshot: Snapshot = { preference: initial, resolved: resolve(initial) }

const listeners = new Set<() => void>()

function applyToDocument(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  // Keeps the phone's status bar and the browser chrome in step.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved])
}

function publish(preference: ThemePreference): void {
  const resolved = resolve(preference)
  if (preference === snapshot.preference && resolved === snapshot.resolved) return
  // A new object every time, because `useSyncExternalStore` compares by identity.
  snapshot = { preference, resolved }
  applyToDocument(resolved)
  for (const listener of listeners) listener()
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Not being able to remember the choice is no reason to ignore it.
  }
  publish(preference)
}

/** Flip to the opposite of what is currently on screen, pinning the choice. */
export function toggleTheme(): void {
  setThemePreference(snapshot.resolved === 'dark' ? 'light' : 'dark')
}

applyToDocument(snapshot.resolved)

// While the preference is `system`, the OS stays in charge.
lightMedia().addEventListener('change', () => {
  if (snapshot.preference === 'system') publish('system')
})

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  )
  return { ...state, setPreference: setThemePreference, toggle: toggleTheme }
}
