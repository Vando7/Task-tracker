import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { LoginInput, Me, RegisterInput, SelfUser } from '@task-tracker/shared'
import { api, apiUpload } from '../../lib/api'
import { keys } from '../../lib/keys'

export function useMe() {
  return useQuery({
    queryKey: keys.me(),
    queryFn: () => api<Me>('/api/me'),
    // A 401 is a legitimate answer ("not signed in"), not a transient failure.
    retry: false,
    staleTime: 30_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<{ ok: true }>('/api/auth/login', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me() }),
  })
}

export function useRegister() {
  return useMutation({
    mutationFn: (input: RegisterInput) =>
      api<{ ok: true }>('/api/auth/register', { method: 'POST', body: input }),
  })
}

export function useVerifyEmail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      api<{ ok: true }>('/api/auth/verify', { method: 'POST', body: { token } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me() }),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    // Clear everything: another account must not inherit this one's cache.
    onSuccess: () => queryClient.clear(),
  })
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api<SelfUser>('/api/me', { method: 'PATCH', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me() }),
  })
}

export function useUploadAvatar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => apiUpload<SelfUser>('/api/me/avatar', file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me() }),
  })
}
