import { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Button, Logo, NavBar, NavItem } from '@studio-manfred/manfred-design-system'
import { api } from '@/api/client'
import { LoginScreen } from '@/screens/LoginScreen'
import { QueueScreen } from '@/screens/QueueScreen'
import { ComposerScreen } from '@/screens/ComposerScreen'
import { HistoryScreen } from '@/screens/HistoryScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'

const NAV = [
  { to: '/', label: 'Queue' },
  { to: '/compose', label: 'Compose' },
  { to: '/history', label: 'History' },
  { to: '/settings', label: 'Settings' },
]

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    api.me().then(setAuthed)
  }, [])

  async function logout() {
    await api.logout()
    setAuthed(false)
  }

  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)

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
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Link to="/" aria-label="Manfred home" className="flex items-center gap-2">
            <Logo height={24} />
            <span className="text-muted-foreground">Schedule</span>
          </Link>
          <NavBar aria-label="Main">
            {NAV.map((item) => (
              <NavItem key={item.to} as={Link} to={item.to} active={isActive(item.to)}>
                {item.label}
              </NavItem>
            ))}
          </NavBar>
          <Button type="button" variant="ghost" size="sm" onClick={logout}>
            Log out
          </Button>
        </div>
      </header>
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
