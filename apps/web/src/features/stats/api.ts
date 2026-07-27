import { useQuery } from '@tanstack/react-query'
import type { Fairness, FairnessWindow, Staleness } from '@task-tracker/shared'
import { api } from '../../lib/api'
import { keys } from '../../lib/keys'

/**
 * Everything derived from the completion log: who has been doing
 * what, and which rooms have gone untouched.
 *
 * Both the dashboard and the settings page read these, so the queries live here
 * rather than inline in a component.
 */

export function useFairness(workspaceId: string | undefined, window: FairnessWindow) {
  return useQuery({
    queryKey: keys.fairness(workspaceId ?? '', window),
    queryFn: () => api<Fairness>(`/api/workspaces/${workspaceId}/stats/fairness?window=${window}`),
    enabled: Boolean(workspaceId),
  })
}

export function useStaleness(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.staleness(workspaceId ?? ''),
    queryFn: () => api<Staleness>(`/api/workspaces/${workspaceId}/stats/staleness`),
    enabled: Boolean(workspaceId),
  })
}
