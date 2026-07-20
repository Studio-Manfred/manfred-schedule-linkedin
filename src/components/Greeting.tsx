import { cn } from '@/lib/utils'

interface GreetingProps {
  name: string
  className?: string
}

export function Greeting({ name, className }: GreetingProps) {
  return (
    <h1 className={cn('text-2xl font-semibold tracking-tight', className)}>
      Hello, {name}
    </h1>
  )
}
