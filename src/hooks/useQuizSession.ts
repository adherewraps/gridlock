import confetti from 'canvas-confetti'
import { useCallback, useState } from 'react'
import { recordAnswer, weakKeys, type Progress } from '@/lib/progress'
import { buildQuestion, checkTextAnswer, nextQuestion, weakSpotKeys, type Question, type QuizMode } from '@/lib/quiz'
import type { Anchor, LatLng, Region } from '@/lib/region'

export const SESSION_LENGTH = 10

export interface SessionResult { key: string; ok: boolean; label: string; type: Question['type'] }
export interface QuizSession {
  mode: QuizMode | 'weak'
  queue: string[] | null
  index: number
  question: Question | null
  answered: null | { ok: boolean; picked: string }
  recent: string[]
  results: SessionResult[]
  done: boolean
}

interface Deps {
  region: Region | null
  anchors: Anchor[]
  progress: Progress
  setProgress: (fn: (p: Progress) => Progress) => void
  fly: (focus: Question['focus'] | { kind: 'zoomTo'; at: LatLng; zoom: number }) => void
  flash: (ok: boolean) => void
}

function celebrate(big = false) {
  const colors = ['#22d3ee', '#34d399', '#a78bfa', '#fbbf24']
  confetti({ particleCount: big ? 160 : 90, spread: big ? 100 : 70, origin: { x: 0.35, y: 0.55 }, colors, disableForReducedMotion: true })
  if (big) setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 60, origin: { x: 0.8, y: 0.7 }, colors, disableForReducedMotion: true }), 250)
}

export function useQuizSession({ region, anchors, progress, setProgress, fly, flash }: Deps) {
  const [session, setSession] = useState<QuizSession | null>(null)

  const load = useCallback((s: QuizSession): QuizSession => {
    if (!region) return s
    let q: Question | null = null
    if (s.queue) {
      const key = s.queue[s.index]
      q = key ? buildQuestion(region, anchors, key) : null
    } else {
      q = nextQuestion(region, anchors, s.mode as QuizMode, progress, s.recent)
    }
    if (!q) return { ...s, question: null, done: true }
    fly(q.focus)
    return { ...s, question: q, answered: null, recent: [...s.recent, q.key].slice(-15) }
  }, [region, anchors, progress, fly])

  const start = useCallback((mode: QuizMode | 'weak') => {
    if (!region) return
    const queue = mode === 'weak' ? weakSpotKeys(region, progress, weakKeys(progress)) : null
    setSession(load({ mode, queue, index: 0, question: null, answered: null, recent: [], results: [], done: false }))
  }, [region, progress, load])

  const answer = useCallback((input: { optionId: string } | { text: string }) => {
    if (!session?.question || session.answered || !region) return
    const q = session.question
    const ok = 'optionId' in input ? input.optionId === q.answerId : checkTextAnswer(region, input.text, q.textCorridors ?? [])
    const picked = 'optionId' in input ? input.optionId : input.text
    flash(ok)
    setProgress((p) => recordAnswer(p, { key: q.key, type: q.type, at: q.at, ok }))
    const streak = ok ? progress.streak + 1 : 0
    if (streak > 0 && streak % 5 === 0) celebrate(streak % 10 === 0)
    // Confirm with a camera move: zoom in on the answer so it sticks.
    if (q.focus.kind === 'point') fly({ kind: 'zoomTo', at: q.focus.at, zoom: q.focus.zoom + (ok ? 1 : 0) })
    else fly(q.focus)
    setSession({
      ...session,
      answered: { ok, picked },
      results: [...session.results, { key: q.key, ok, label: q.reveal.label, type: q.type }],
    })
  }, [session, region, progress.streak, setProgress, fly, flash])

  const next = useCallback(() => {
    if (!session) return
    const index = session.index + 1
    const total = session.queue?.length ?? SESSION_LENGTH
    if (index >= total) {
      const correct = session.results.filter((r) => r.ok).length
      if (correct / session.results.length >= 0.8) celebrate(true)
      setSession({ ...session, index, done: true, question: null, answered: null })
      return
    }
    setSession(load({ ...session, index }))
  }, [session, load])

  const quit = useCallback(() => setSession(null), [])

  return { session, start, answer, next, quit }
}
