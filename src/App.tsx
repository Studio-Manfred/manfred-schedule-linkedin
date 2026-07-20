import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { AppHeader, Badge, NavBar, NavItem } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { LoginScreen } from '@/screens/LoginScreen'
import { QueueScreen } from '@/screens/QueueScreen'
import { ComposerScreen } from '@/screens/ComposerScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [counts, setCounts] = useState({ queue: 0, history: 0 })
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    api.me().then(setAuthed)
  }, [])

  // Keep the nav badges fresh: refetch on auth and whenever the route changes
  // (e.g. after adding or deleting a post and navigating back).
  useEffect(() => {
    if (authed !== true) return
    let cancelled = false
    api
      .listPosts()
      .then((posts) => {
        if (cancelled) return
        setCounts({
          queue: posts.filter((p) => p.status === 'queued').length,
          history: posts.filter((p) => ['published', 'failed', 'missed'].includes(p.status)).length,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [authed, location.pathname])

  async function logout() {
    await api.logout()
    setAuthed(false)
  }

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

  const NAV = [
    { to: '/', label: 'Queue', count: counts.queue },
    { to: '/compose', label: 'Compose', count: null },
    { to: '/history', label: 'History', count: counts.history },
    { to: '/settings', label: 'Settings', count: null },
  ]

  if (authed === null) return <p className="p-8">Loading…</p>
  if (!authed)
    return (
      <LoginScreen
        onSuccess={() => {
          setAuthed(true)
          navigate('/')
        }}
      />
    )

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">
        Skip to content
      </a>
      <AppHeader
        appName="Schedule"
        user={{ name: 'Jens Wedin', onSignOut: logout, signOutLabel: 'Log out' }}
        nav={
          <NavBar aria-label="Main">
            {NAV.map((item) => (
              <NavItem key={item.to} as={Link} to={item.to} active={isActive(item.to)}>
                <span className="inline-flex items-center gap-2">
                  {item.label}
                  {item.count != null && (
                    <Badge variant="neutral" size="sm">
                      {item.count}
                    </Badge>
                  )}
                </span>
              </NavItem>
            ))}
          </NavBar>
        }
      />
      <main id="main" className="mx-auto max-w-3xl p-4 sm:p-8">
        <Routes>
          <Route path="/" element={<QueueScreen />} />
          <Route path="/compose" element={<ComposerScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/settings" element={<SettingsScreen onLogout={() => setAuthed(false)} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  )
}
