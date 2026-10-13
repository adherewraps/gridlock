import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const pct = (n: number) => `${Math.round(n * 100)}%`

export function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function weightedPick<T>(xs: T[], weight: (x: T) => number): T {
  const ws = xs.map((x) => Math.max(0, weight(x)))
  let r = Math.random() * ws.reduce((s, w) => s + w, 0)
  for (let i = 0; i < xs.length; i++) if ((r -= ws[i]) <= 0) return xs[i]
  return xs[xs.length - 1]
}
