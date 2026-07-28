/**
 * The household you were last in.
 *
 * Per device, like the theme, and deliberately *not* on the server. The legacy app
 * kept the current workspace in the session, which is why a cleared cookie or a
 * revoked membership crashed its index view — the stored id was treated as the
 * answer rather than as a hint.
 *
 * So this is only ever a hint. `landingWorkspace` resolves it against the list the
 * caller can actually see and falls back to the first one, which means a household
 * you were removed from degrades to "you land somewhere sensible" instead of an
 * error, and no route ever renders from a workspace id that is not in `me`.
 */

const STORAGE_KEY = 'tt-last-workspace'

/** Storage can throw in private mode. A forgotten preference is not worth an error. */
export function rememberWorkspace(workspaceId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, workspaceId)
  } catch {
    // Nothing to do: the fallback below is the same one a first visit gets.
  }
}

function readRemembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Where `/` should send someone: where they were, else their first household. */
export function landingWorkspace<T extends { id: string }>(
  workspaces: readonly T[],
): T | undefined {
  const remembered = readRemembered()
  return workspaces.find((workspace) => workspace.id === remembered) ?? workspaces[0]
}
