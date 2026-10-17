// Question generation. Every question has a stable `key` so spaced repetition can
// rebuild it later (with fresh distractors) from nothing but the key.
import { MAX_BOX, type Progress } from './progress'
import {
  districtCenter, fmtMi, meters, rectCenter, type Anchor, type Corridor, type District, type Intersection,
  type LatLng, type Quadrant, type Rect, type Region,
} from './region'
import { shuffle, weightedPick } from './utils'

export type QuizType = 'intersection' | 'boundary' | 'connection'
export type QuizMode = QuizType | 'mixed'
export interface Option { id: string; label: string }
export type Focus =
  | { kind: 'point'; at: LatLng; zoom: number }
  | { kind: 'rect'; rect: Rect; rings?: LatLng[][] }
  | { kind: 'pair'; a: Anchor; b: Anchor }

export interface Question {
  key: string
  type: QuizType
  prompt: string
  hint?: string
  options: Option[]
  answerId: string
  /** For free-text answering: the corridor ids the user must name. */
  textCorridors?: string[]
  focus: Focus
  reveal: { corridors: string[]; label: string; labelAt: LatLng }
  explanation: string[]
  at: LatLng
}

const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0]
type Side = 'north' | 'south' | 'east' | 'west'
const SIDES: Side[] = ['north', 'south', 'east', 'west']

function gridPosition(r: Region, p: LatLng) {
  if (!r.region.origin) return null
  const { lat, lon } = r.region.origin
  const ns = meters([lat, lon], [p[0], lon]), ew = meters([lat, lon], [lat, p[1]])
  return `${fmtMi(ns)} ${p[0] >= lat ? 'N' : 'S'} · ${fmtMi(ew)} ${p[1] >= lon ? 'E' : 'W'} of ${r.region.origin.label}`
}

// ── Intersection identification ──────────────────────────────────────────
function intersectionQ(r: Region, ix: Intersection): Question {
  const others = r.intersections.filter((o) => o.id !== ix.id && r.ixLabel(o) !== r.ixLabel(ix))
  const byDist = (xs: Intersection[]) => xs.sort((p, q) => meters(p.at, ix.at) - meters(q.at, ix.at))
  // Hardest distractors share a road with the answer; mix in a nearby wildcard.
  const sharing = byDist(others.filter((o) => [o.a, o.b].some((c) => c === ix.a || c === ix.b))).slice(0, 5)
  const nearby = byDist(others.slice()).slice(0, 6)
  const picks = new Map<string, Intersection>()
  for (const o of [...shuffle(sharing).slice(0, 2), ...shuffle(nearby), ...sharing]) {
    if (picks.size >= 3) break
    if (![...picks.values()].some((p) => r.ixLabel(p) === r.ixLabel(o))) picks.set(o.id, o)
  }
  const A = r.corridorById.get(ix.a)!, B = r.corridorById.get(ix.b)!
  const near = r.landmarks.map((l) => ({ l, d: meters(l.at, ix.at) })).sort((p, q) => p.d - q.d)[0]
  return {
    key: `ix:${ix.id}`,
    type: 'intersection',
    prompt: 'Which junction is marked?',
    hint: r.describe(ix.at),
    options: shuffle([ix, ...picks.values()]).map((o) => ({ id: o.id, label: r.ixLabel(o) })),
    answerId: ix.id,
    textCorridors: [ix.a, ix.b],
    focus: { kind: 'point', at: ix.at, zoom: A.kind === 'freeway' && B.kind === 'freeway' ? 13 : 14 },
    reveal: { corridors: [ix.a, ix.b], label: r.ixLabel(ix), labelAt: ix.at },
    explanation: [
      `${r.ixLabel(ix)} — ${[r.describe(ix.at), gridPosition(r, ix.at)].filter(Boolean).join('; ')}.`,
      `${A.name}: ${firstSentence(A.desc)}`,
      `${B.name}: ${firstSentence(B.desc)}`,
      ...(near && near.d < 3000 ? [`Nearest anchor: ${near.l.name} (${fmtMi(near.d)} away).`] : []),
    ],
    at: ix.at,
  }
}

// ── Boundary / sector match ──────────────────────────────────────────────
function districtQ(r: Region, d: District): Question {
  const c = districtCenter(d)
  // Towns are compared with towns, neighborhoods with neighborhoods.
  const others = r.districts.filter((o) => o.id !== d.id && o.kind === d.kind)
    .sort((p, q) => meters(districtCenter(p), c) - meters(districtCenter(q), c))
  const opts = shuffle([d, ...shuffle(others.slice(0, 5)).slice(0, 3)])
  const b = d.boundedBy
  const edges = [b.north && `${b.north} (N)`, b.south && `${b.south} (S)`, b.west && `${b.west} (W)`, b.east && `${b.east} (E)`].filter(Boolean)
  const q = r.quadrantOf(c)
  const nearRoads = r.corridorsNear(c, 2500).slice(0, 3).map((x) => x.corridor.name)
  return {
    key: `bd:${d.id}`,
    type: 'boundary',
    prompt: d.kind === 'municipality' ? 'Which town or city is outlined?' : 'Which area is outlined?',
    // Towns span several quadrants, so a quadrant hint would mislead.
    hint: q && d.kind === 'area' ? `${q} quadrant` : undefined,
    options: opts.map((o) => ({ id: o.id, label: o.name })),
    answerId: d.id,
    focus: { kind: 'rect', rect: d.rect, rings: d.rings },
    reveal: { corridors: Object.values(b).flatMap((n) => r.corridors.filter((x) => x.name === n).map((x) => x.id)), label: d.name, labelAt: c },
    explanation: [
      `${d.name}: ${d.why}`,
      edges.length ? `Bounded by ${edges.join(', ')}.` : nearRoads.length ? `Main roads through it: ${nearRoads.join(', ')}.` : '',
    ].filter(Boolean),
    at: c,
  }
}

function quadrantQ(r: Region, q: Quadrant): Question {
  const rect = r.quadrants[q]!
  const names: Record<Quadrant, string> = { NW: 'Northwest', NE: 'Northeast', SW: 'Southwest', SE: 'Southeast' }
  const ns = q[0] === 'N' ? 'north' : 'south', ew = q[1] === 'E' ? 'east' : 'west'
  const o = r.region.origin!
  const ewName = r.corridorById.get(o.ew)?.name, nsName = r.corridorById.get(o.ns)?.name
  return {
    key: `qd:${q}`,
    type: 'boundary',
    prompt: 'Which address quadrant is highlighted?',
    options: (['NW', 'NE', 'SW', 'SE'] as Quadrant[]).map((x) => ({ id: x, label: `${names[x]} (${x})` })),
    answerId: q,
    focus: { kind: 'rect', rect },
    reveal: { corridors: [o.ew, o.ns], label: `${names[q]} quadrant`, labelAt: rectCenter(rect) },
    explanation: [
      `Addresses here are ${ns} of ${ewName} and ${ew} of ${nsName}.`,
      (ew === 'west' ? o.westHint : o.eastHint) ?? o.note,
    ],
    at: rectCenter(rect),
  }
}

function edgeQ(r: Region, d: District, side: Side): Question | null {
  const name = d.boundedBy[side]
  const answer = r.corridors.find((c) => c.name === name)
  if (!answer || answer.axisValue == null) return null
  const sameAxis = r.corridors.filter((c) => c.axis === answer.axis && c.id !== answer.id && c.axisValue != null)
    .sort((p, q) => Math.abs(p.axisValue! - answer.axisValue!) - Math.abs(q.axisValue! - answer.axisValue!))
  const opts = shuffle([answer, ...shuffle(sameAxis.slice(0, 5)).slice(0, 3)])
  const [s, w, n, e] = d.rect
  const edgeAt: Record<Side, LatLng> = { north: [n, (w + e) / 2], south: [s, (w + e) / 2], west: [(s + n) / 2, w], east: [(s + n) / 2, e] }
  return {
    key: `be:${d.id}:${side}`,
    type: 'boundary',
    prompt: `Which road forms the ${side.toUpperCase()} edge of ${d.name}?`,
    options: opts.map((o) => ({ id: o.id, label: o.name })),
    answerId: answer.id,
    focus: { kind: 'rect', rect: d.rect, rings: d.rings },
    reveal: { corridors: [answer.id], label: answer.name, labelAt: edgeAt[side] },
    explanation: [`${answer.name}: ${firstSentence(answer.desc)}`, `${d.name}: ${d.why}`],
    at: edgeAt[side],
  }
}

// ── Corridor connection ──────────────────────────────────────────────────
const CONNECT_RADIUS = 1500
function connectionQ(r: Region, corridor: Corridor, A: Anchor, B: Anchor): Question {
  const nearA = r.corridorsNear(A.at, CONNECT_RADIUS).map((x) => x.corridor.id)
  const nearB = new Set(r.corridorsNear(B.at, CONNECT_RADIUS).map((x) => x.corridor.id))
  const alsoValid = new Set(nearA.filter((id) => nearB.has(id)))
  const mid: LatLng = [(A.at[0] + B.at[0]) / 2, (A.at[1] + B.at[1]) / 2]
  const similar = r.corridors
    .filter((c) => !alsoValid.has(c.id) && (corridor.kind === 'freeway' ? c.kind === 'freeway' : c.kind === 'arterial'))
    .map((c) => ({ c, d: r.corridorsNear(mid, 1e9).find((x) => x.corridor.id === c.id)!.d }))
    .sort((p, q) => p.d - q.d)
  const opts = shuffle([corridor, ...shuffle(similar.slice(0, 6)).slice(0, 3).map((x) => x.c)])
  const dA = r.corridorsNear(A.at, 1e9).find((x) => x.corridor.id === corridor.id)!
  const dB = r.corridorsNear(B.at, 1e9).find((x) => x.corridor.id === corridor.id)!
  return {
    key: `cn:${corridor.id}:${A.id}:${B.id}`,
    type: 'connection',
    prompt: `Which primary route connects ${A.name} to ${B.name}?`,
    hint: `${fmtMi(meters(A.at, B.at))} apart`,
    options: opts.map((o) => ({ id: o.id, label: o.name })),
    answerId: corridor.id,
    focus: { kind: 'pair', a: A, b: B },
    reveal: { corridors: [corridor.id], label: corridor.name, labelAt: dA.at },
    explanation: [
      `${corridor.name} passes ${fmtMi(dA.d)} from ${A.name} and ${fmtMi(dB.d)} from ${B.name}.`,
      corridor.desc,
      ...(alsoValid.size > 1 ? [`Also serves both: ${[...alsoValid].filter((id) => id !== corridor.id).map((id) => r.corridorById.get(id)!.name).join(', ')}.`] : []),
    ],
    at: mid,
  }
}

// ── Pools & key round-tripping ───────────────────────────────────────────
export function connectionKeys(r: Region, anchors: Anchor[]): string[] {
  const keys: string[] = []
  const near = new Map(anchors.map((a) => [a.id, new Set(r.corridorsNear(a.at, CONNECT_RADIUS).map((x) => x.corridor.id))]))
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++) {
      const [A, B] = [anchors[i], anchors[j]]
      if (meters(A.at, B.at) < 3000) continue
      for (const id of near.get(A.id)!) if (near.get(B.id)!.has(id)) keys.push(`cn:${id}:${A.id}:${B.id}`)
    }
  return keys
}

export function poolFor(r: Region, anchors: Anchor[], type: QuizType): string[] {
  if (type === 'intersection') return r.intersections.map((x) => `ix:${x.id}`)
  if (type === 'connection') return connectionKeys(r, anchors)
  return [
    ...r.districts.map((d) => `bd:${d.id}`),
    ...(r.region.origin ? (['NW', 'NE', 'SW', 'SE'] as const).map((q) => `qd:${q}`) : []),
    ...r.districts.flatMap((d) => SIDES.filter((s) => d.boundedBy[s]).map((s) => `be:${d.id}:${s}`)),
  ]
}

export function buildQuestion(r: Region, anchors: Anchor[], key: string): Question | null {
  const [kind, ...rest] = key.split(':')
  if (kind === 'ix') { const ix = r.intersectionById.get(rest.join(':')); return ix ? intersectionQ(r, ix) : null }
  if (kind === 'bd') { const d = r.districtById.get(rest[0]); return d ? districtQ(r, d) : null }
  if (kind === 'qd') return r.quadrants[rest[0] as Quadrant] ? quadrantQ(r, rest[0] as Quadrant) : null
  if (kind === 'be') { const d = r.districtById.get(rest[0]); return d ? edgeQ(r, d, rest[1] as Side) : null }
  if (kind === 'cn') {
    const c = r.corridorById.get(rest[0])
    const A = anchors.find((a) => a.id === rest[1]), B = anchors.find((a) => a.id === rest[2])
    return c && A && B ? connectionQ(r, c, A, B) : null
  }
  return null
}

/** Spaced-repetition draw: unseen and low-box items are more likely; recent ones are skipped. */
export function nextQuestion(r: Region, anchors: Anchor[], mode: QuizMode, progress: Progress, recent: string[]): Question | null {
  const type: QuizType = mode !== 'mixed' ? mode
    : weightedPick(['intersection', 'boundary', 'connection'] as QuizType[], (t) => ({ intersection: 5, boundary: 3, connection: 2 })[t])
  const pool = poolFor(r, anchors, type).filter((k) => !recent.includes(k))
  if (!pool.length) return null
  for (let tries = 0; tries < 5; tries++) {
    const key = weightedPick(pool, (k) => {
      const rec = progress.items[k]
      return rec ? MAX_BOX - rec.box + 1 : MAX_BOX + 2
    })
    const q = buildQuestion(r, anchors, key)
    if (q) return q
  }
  return null
}

/** Missed items first; pad with intersections near missed coordinates. */
export function weakSpotKeys(r: Region, progress: Progress, ranked: string[], n = 10): string[] {
  const keys = ranked.slice(0, n)
  if (keys.length >= n || !keys.length) return shuffle(keys)
  const missedAt = progress.history.filter((e) => !e.ok).map((e) => e.at)
  const neighbors = r.intersections
    .map((x) => ({ k: `ix:${x.id}`, d: Math.min(...missedAt.map((p) => meters(p, x.at))) }))
    .filter((x) => x.d < 2500 && !keys.includes(x.k))
    .sort((a, b) => a.d - b.d)
  return shuffle([...keys, ...neighbors.slice(0, n - keys.length).map((x) => x.k)])
}

// ── Free-text answers ────────────────────────────────────────────────────
const ABBR: Record<string, string> = { road: 'rd', street: 'st', avenue: 'ave', boulevard: 'blvd', drive: 'dr', freeway: 'fwy', expressway: 'expwy', interstate: 'i', highway: 'hwy' }
const SUFFIX = new Set(['rd', 'st', 'ave', 'blvd', 'dr', 'fwy', 'expwy', 'hwy'])
const DIRS = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'the'])
function norm(s: string): { full: string; core: string } {
  const toks = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
    .map((t) => ABBR[t] ?? t).filter((t, i) => !(i === 0 && DIRS.has(t)))
  const core = SUFFIX.has(toks[toks.length - 1]) ? toks.slice(0, -1) : toks
  return { full: toks.join(''), core: core.join('') }
}

/** Which corridors a typed fragment could mean. Bare "7th" is ambiguous and matches nothing. */
export function matchCorridors(r: Region, fragment: string): Corridor[] {
  const f = norm(fragment)
  if (!f.full) return []
  const exact = r.corridors.filter((c) => c.aliases.some((a) => norm(a).full === f.full))
  if (exact.length) return exact
  const byCore = r.corridors.filter((c) => c.aliases.some((a) => norm(a).core === f.core))
  return byCore.length === 1 ? byCore : []
}

export function checkTextAnswer(r: Region, input: string, target: string[]): boolean {
  const parts = input.split(/\s*(?:&|\band\b|\bat\b|@|\/|,|\bx\b|\+)\s*/i).filter((s) => s.trim())
  if (parts.length !== target.length) return false
  const matched = parts.map((p) => matchCorridors(r, p).map((c) => c.id))
  return target.every((t) => matched.some((m) => m.includes(t)))
}
