import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Icon } from './components/Icon'
import { Shell } from './components/Shell'
import { useMe } from './features/session/api'
import { useEventStream } from './lib/useEventStream'
import { DashboardPage } from './routes/DashboardPage'
import { HousePage } from './routes/HousePage'
import { NotFoundPage } from './routes/NotFoundPage'
import { SettingsPage } from './routes/SettingsPage'
import { SignInPage } from './routes/SignInPage'
import { TasksPage } from './routes/TasksPage'
import { VerifyPage } from './routes/VerifyPage'
import { WorkspacesPage } from './routes/WorkspacesPage'

/**
 * Routing note: filters live in the URL query string, so a filtered view is
 * linkable and survives a reload (section 4.1). The legacy app kept the current
 * workspace in the *session*, which is why a cleared cookie or a revoked
 * membership crashed the index view (Part 2, problem 10).
 */
export function App() {
  const { data: me, isPending, isError } = useMe()

  if (isPending) {
    return (
      <div className="grid min-h-dvh place-items-center text-text-dim">
        <span className="flex items-center gap-2">
          <span className="size-2 animate-shimmer rounded-full bg-accent" />
          Loading…
        </span>
      </div>
    )
  }

  // Not signed in, or signed in but unverified.
  if (isError || !me) {
    return (
      <Routes>
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="*" element={<SignInPage />} />
      </Routes>
    )
  }

  if (!me.user.emailVerifiedAt) {
    return (
      <Routes>
        <Route path="/verify" element={<VerifyPage />} />
        <Route
          path="*"
          element={
            <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
              <div className="card p-6 text-center">
                <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent/15 text-accent-soft">
                  <Icon name="mail" size={24} />
                </span>
                <h1 className="mt-3 text-xl font-semibold">Confirm your email</h1>
                <p className="mt-2 text-text-dim">
                  We sent a link to <strong className="text-text">{me.user.email}</strong>. In
                  development it is printed to the server console.
                </p>
              </div>
            </div>
          }
        />
      </Routes>
    )
  }

  if (me.workspaces.length === 0) {
    return <WorkspacesPage me={me} />
  }

  return (
    <Routes>
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/workspaces" element={<WorkspacesPage me={me} />} />
      <Route path="/" element={<Navigate to={`/w/${me.workspaces[0]?.id}`} replace />} />
      <Route path="/w/:workspaceId/*" element={<WorkspaceRoutes me={me} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

type Me = NonNullable<ReturnType<typeof useMe>['data']>

function WorkspaceRoutes({ me }: { me: Me }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const workspace = me.workspaces.find((candidate) => candidate.id === workspaceId)

  // Flash-on-change, kept from the legacy app because it is genuinely nice — but
  // driven by an SSE event for a known task id rather than by string-diffing
  // timestamps out of hidden spans.
  const [flashing, setFlashing] = useState<Set<string>>(new Set())

  useEventStream({
    workspaceId: workspace?.id,
    currentUserId: me.user.id,
    onFlash: (taskId) =>
      setFlashing((current) => {
        const next = new Set(current)
        next.add(taskId)
        return next
      }),
  })

  useEffect(() => {
    if (flashing.size === 0) return
    const timer = setTimeout(() => setFlashing(new Set()), 1400)
    return () => clearTimeout(timer)
  }, [flashing])

  if (!workspace) return <Navigate to="/workspaces" replace />

  return (
    <Shell me={me} workspace={workspace}>
      <Routes>
        {/* The landing page is the dashboard — what needs doing, yours first. The
            floor plan moved to /house, where its editing controls belong. */}
        <Route
          path="/"
          element={<DashboardPage workspace={workspace} me={me} flashing={flashing} />}
        />
        <Route path="house" element={<HousePage workspace={workspace} />} />
        <Route path="tasks" element={<TasksPage workspace={workspace} flashing={flashing} />} />
        <Route path="settings" element={<SettingsPage workspace={workspace} me={me} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Shell>
  )
}
