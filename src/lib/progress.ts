// Learning progress: a Leitner-box record per quiz item, plus a raw answer log
// from which all spatial analytics (sectors, heatmap) are derived on demand.
import type { LatLng, Quadrant, Rect, Region } from './region'

export type ItemType = 'intersection' | 'boundary' | 'connection' | 'route'

export interface ItemRecord {
  seen: number
  correct: number
  wrong: number
  /** Consecutive correct answers. */
  streak: number
  /** Leitner box 0–5: 0 = just missed, 5 = solid. */
  box: number
  lastSeen: number
  lastCorrect: boolean
}

export interface AnswerEvent { key: string; type: ItemType; at: LatLng; ok: boolean; t: number }

export interface Progress {
  items: Record<string, ItemRecord>
  history: AnswerEvent[]
  streak: number
  bestStreak: number
}

export const MAX_BOX = 5
const HISTORY_CAP = 2000

export const emptyProgress = (): Progress => ({ items: {}, history: [], streak: 0, bestStreak: 0 })

export function recordAnswer(p: Progress, e: Omit<AnswerEvent, 't'>): Progress {
  const t = Date.now()
  const prev = p.items[e.key] ?? { seen: 0, correct: 0, wrong: 0, streak: 0, box: 0, lastSeen: 0, lastCorrect: false }
  const item: ItemRecord = {
    seen: prev.seen + 1,
    correct: prev.correct + (e.ok ? 1 : 0),
    wrong: prev.wrong + (e.ok ? 0 : 1),
    streak: e.ok ? prev.streak + 1 : 0,
    box: e.ok ? Math.min(MAX_BOX, prev.box + 1) : 0,
    lastSeen: t,
    lastCorrect: e.ok,
  }
  // Route attempts don't count toward the quiz streak.
  const streak = e.type === 'route' ? p.streak : e.ok ? p.streak + 1 : 0
  return {
    items: { ...p.items, [e.key]: item },
    history: [...p.history, { ...e, t }].slice(-HISTORY_CAP),
    streak,
    bestStreak: Math.max(p.bestStreak, streak),
  }
}

/**
 * How urgently an item needs review. Higher = review sooner.
 * Used to rank the "Target My Weak Spots" quiz and the Analytics review list.
 * Only called for items that have been missed at least once (r.wrong > 0).
 */
export function weaknessScore(r: ItemRecord, now: number): number {
  // TODO(human): rank missed items for review (see Learn-by-Doing notes)
  void now
  return r.wrong
}

export function weakKeys(p: Progress, limit = Infinity): string[] {
  const now = Date.now()
  return Object.entries(p.items)
    .filter(([, r]) => r.wrong > 0)
    .map(([k, r]) => [k, weaknessScore(r, now)] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k)
}

/**
 * 0–100. Average Leitner level across studied items, but the denominator never drops
 * below 40 — so acing three questions doesn't read as "mastered the city".
 */
export function masteryScore(p: Progress): number {
  const recs = Object.entries(p.items).filter(([k]) => !k.startsWith('rt:')).map(([, r]) => r)
  const sum = recs.reduce((s, r) => s + r.box / MAX_BOX, 0)
  return Math.round((100 * sum) / Math.max(recs.length, 40))
}

export interface Tally { n: number; ok: number }
const tally = (): Tally => ({ n: 0, ok: 0 })
export const acc = (t: Tally | undefined) => (t && t.n ? t.ok / t.n : null)

export function sectorStats(region: Region, history: AnswerEvent[]) {
  const districts = new Map<string, Tally>()
  const quadrants: Record<Quadrant, Tally> = { NW: tally(), NE: tally(), SW: tally(), SE: tally() }
  const types: Record<ItemType, Tally> = { intersection: tally(), boundary: tally(), connection: tally(), route: tally() }
  for (const e of history) {
    const qd = region.quadrantOf(e.at)
    if (qd) { quadrants[qd].n++; quadrants[qd].ok += +e.ok }
    types[e.type].n++; types[e.type].ok += +e.ok
    const d = region.districtAt(e.at)
    if (d) {
      const t = districts.get(d.id) ?? tally()
      t.n++; t.ok += +e.ok
      districts.set(d.id, t)
    }
  }
  return { districts, quadrants, types }
}

/** ~1.5-mile grid cells for the spatial mastery heatmap. Recent answers count more. */
export function heatCells(history: AnswerEvent[]): { rect: Rect; n: number; score: number }[] {
  const DLAT = 0.0217, DLON = 0.026
  const cells = new Map<string, { i: number; j: number; w: number; ok: number; n: number }>()
  history.forEach((e, idx) => {
    const i = Math.floor(e.at[0] / DLAT), j = Math.floor(e.at[1] / DLON)
    const k = `${i}:${j}`
    const c = cells.get(k) ?? { i, j, w: 0, ok: 0, n: 0 }
    const w = 0.5 + (idx / Math.max(1, history.length)) // recency weighting
    c.w += w; c.ok += e.ok ? w : 0; c.n++
    cells.set(k, c)
  })
  return [...cells.values()].map((c) => ({
    rect: [c.i * DLAT, c.j * DLON, (c.i + 1) * DLAT, (c.j + 1) * DLON] as Rect,
    n: c.n,
    score: c.ok / c.w,
  }))
}

/** Red → amber → emerald. */
export function scoreColor(score: number | null): string {
  if (score == null) return '#64748b'
  if (score < 0.5) return '#ef4444'
  if (score < 0.7) return '#f97316'
  if (score < 0.85) return '#eab308'
  return '#10b981'
}
