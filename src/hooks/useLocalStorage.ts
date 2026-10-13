import { useCallback, useEffect, useState } from 'react'

const NS = 'gridlock:'

/** useState that survives reloads. Falls back silently if storage is unavailable. */
export function useLocalStorage<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(NS + key)
      if (raw != null) return JSON.parse(raw) as T
    } catch { /* private mode / corrupted JSON */ }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })
  useEffect(() => {
    try { localStorage.setItem(NS + key, JSON.stringify(value)) } catch { /* quota */ }
  }, [key, value])
  const reset = useCallback(() => setValue(typeof initial === 'function' ? (initial as () => T)() : initial), [initial])
  return [value, setValue, reset] as const
}
