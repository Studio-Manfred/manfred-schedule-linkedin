import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
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

  useEffect(() => {
    api.me().then(setAuthed)
  }, [])

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
    <div className="mx-auto min-h-dvh max-w-3xl p-4 sm:p-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="mb-8 flex items-center justify-between">
        <p className="font-semibold">Manfred Schedule</p>
        <nav aria-label="Main">
          <ul className="flex gap-4">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    isActive ? 'font-semibold underline underline-offset-4' : 'hover:underline'
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<QueueScreen />} />
          <Route path="/compose" element={<ComposerScreen />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/settings" element={<SettingsScreen onLogout={() => setAuthed(false)} />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
