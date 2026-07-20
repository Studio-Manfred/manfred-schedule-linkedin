import { Button } from '@studio-manfred/manfred-design-system'
import { Greeting } from '@/components/Greeting'

export default function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-start gap-6 p-8">
      {/* manfred-schedule-linkedin is replaced by scripts/bootstrap.mjs at scaffold time */}
      <Greeting name="manfred-schedule-linkedin" />
      <p className="text-muted-foreground">
        A Manfred starter — React + Vite + Tailwind + the Manfred design system.
      </p>
      <Button variant="brand">Get started</Button>
    </main>
  )
}
