import { Button } from '@studio-manfred/manfred-design-system'

export function LoginScreen() {
  const error = new URLSearchParams(window.location.search).get('error')

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Manfred Schedule</h1>
      {error && (
        <p role="alert" className="text-destructive">
          Sign-in failed. Please try again.
        </p>
      )}
      <Button variant="brand" asChild>
        <a href="/api/auth/google/start">Sign in with Google</a>
      </Button>
    </main>
  )
}
