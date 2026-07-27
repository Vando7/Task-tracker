import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateFloorInput,
  CreateRoomInput,
  Floor,
  Layout,
  Member,
  Room,
  UpdateFloorInput,
  UpdateRoomInput,
  Workspace,
} from '@task-tracker/shared'
import { api } from '../../lib/api'
import { keys } from '../../lib/keys'

export function useLayout(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.layout(workspaceId ?? ''),
    queryFn: () => api<Layout>(`/api/workspaces/${workspaceId}/layout`),
    enabled: Boolean(workspaceId),
  })
}

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.members(workspaceId ?? ''),
    queryFn: () => api<Member[]>(`/api/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
  })
}

/** Invalidate the layout after any structural change; the SSE event covers other clients. */
function useLayoutInvalidation(workspaceId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: keys.layout(workspaceId) })
}

export function useCreateFloor(workspaceId: string) {
  const invalidate = useLayoutInvalidation(workspaceId)
  return useMutation({
    mutationFn: (input: CreateFloorInput) =>
      api<Floor>(`/api/workspaces/${workspaceId}/floors`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useUpdateFloor(workspaceId: string) {
  const invalidate = useLayoutInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ floorId, ...input }: UpdateFloorInput & { floorId: string }) =>
      api<Floor>(`/api/floors/${floorId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  })
}

export function useDeleteFloor(workspaceId: string) {
  const invalidate = useLayoutInvalidation(workspaceId)
  return useMutation({
    mutationFn: (floorId: string) => api<void>(`/api/floors/${floorId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useCreateRoom(workspaceId: string) {
  const invalidate = useLayoutInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ floorId, ...input }: CreateRoomInput & { floorId: string }) =>
      api<Room>(`/api/floors/${floorId}/rooms`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useUpdateRoom(workspaceId: string) {
  const invalidate = useLayoutInvalidation(workspaceId)
  return useMutation({
    mutationFn: ({ roomId, ...input }: UpdateRoomInput & { roomId: string }) =>
      api<Room>(`/api/rooms/${roomId}`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  })
}

export function useDeleteRoom(workspaceId: string) {
  const invalidate = useLayoutInvalidation(workspaceId)
  return useMutation({
    mutationFn: (roomId: string) => api<void>(`/api/rooms/${roomId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; timezone?: string }) =>
      api<Workspace>('/api/workspaces', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me() }),
  })
}

export function useAddMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (email: string) =>
      api<Member>(`/api/workspaces/${workspaceId}/members`, { method: 'POST', body: { email } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) }),
  })
}

export function useRemoveMember(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/api/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) })
      void queryClient.invalidateQueries({ queryKey: keys.taskList(workspaceId) })
    },
  })
}
