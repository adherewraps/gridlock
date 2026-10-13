import * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'flex h-9 w-full rounded-md border bg-card/60 px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border bg-card/60 px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 cursor-pointer',
        className,
      )}
      {...props}
    />
  )
}
