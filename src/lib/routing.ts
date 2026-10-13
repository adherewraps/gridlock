// Corridor-level router. Nodes are the derived intersections; edges run along a
// corridor between consecutive intersections. Good enough to answer "which primary
// roads would a local use?" — deliberately NOT turn-by-turn.
import { meters, type Anchor, type LatLng, type Region } from './region'

const SPEED = { freeway: 26, arterial: 15, local: 9 } // m/s ≈ 58 / 34 / 20 mph incl. signals

interface Edge { to: string; w: number; corridor: string | null; coords: LatLng[]; m: number }
export interface Leg { corridor: string | null; m: number; s: number; coords: LatLng[] }
export interface Route { legs: Leg[]; seconds: number; meters: number; corridors: string[] }

function project(line: LatLng[], p: LatLng) {
  let best = { d: Infinity, s: 0, i: 0, t: 0 }
  let acc = 0
  for (let i = 0; i < line.length - 1; i++) {
    const [a, b] = [line[i], line[i + 1]]
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0
    const segM = meters(a, b)
    const d = meters(p, [a[0] + t * dx, a[1] + t * dy])
    if (d < best.d) best = { d, s: acc + t * segM, i, t }
    acc += segM
  }
  return best
}

function slice(line: LatLng[], from: ReturnType<typeof project>, to: ReturnType<typeof project>): LatLng[] {
  const fwd = from.s <= to.s
  const [p, q] = fwd ? [from, to] : [to, from]
  const at = (x: typeof p): LatLng => {
    const [a, b] = [line[x.i], line[x.i + 1]]
    return [a[0] + x.t * (b[0] - a[0]), a[1] + x.t * (b[1] - a[1])]
  }
  const pts = [at(p), ...line.slice(p.i + 1, q.i + 1), at(q)]
  return fwd ? pts : pts.reverse()
}

export type Graph = Map<string, Edge[]>

export function buildGraph(r: Region): Graph {
  const g: Graph = new Map(r.intersections.map((x) => [x.id, []]))
  for (const c of r.corridors) {
    const speed = c.kind === 'freeway' ? SPEED.freeway : SPEED.arterial
    const mine = r.intersections.filter((x) => x.a === c.id || x.b === c.id)
    // Snap each junction to the corridor line it sits on, then link neighbours along that line.
    const byLine = new Map<number, { id: string; pr: ReturnType<typeof project> }[]>()
    for (const x of mine) {
      let bestLine = -1, bestPr: ReturnType<typeof project> | null = null
      c.lines.forEach((l, li) => {
        const pr = project(l, x.at)
        if (!bestPr || pr.d < bestPr.d - 25 || (pr.d < bestPr.d + 25 && l.length > c.lines[bestLine].length)) { bestPr = pr; bestLine = li }
      })
      if (bestPr && (bestPr as { d: number }).d < 900) {
        const arr = byLine.get(bestLine) ?? []
        arr.push({ id: x.id, pr: bestPr })
        byLine.set(bestLine, arr)
      }
    }
    for (const [li, xs] of byLine) {
      xs.sort((p, q) => p.pr.s - q.pr.s)
      for (let i = 0; i < xs.length - 1; i++) {
        const [p, q] = [xs[i], xs[i + 1]]
        const m = Math.abs(q.pr.s - p.pr.s)
        if (m < 1) continue
        const coords = slice(c.lines[li], p.pr, q.pr)
        g.get(p.id)!.push({ to: q.id, w: m / speed, corridor: c.id, coords, m })
        g.get(q.id)!.push({ to: p.id, w: m / speed, corridor: c.id, coords: coords.slice().reverse(), m })
      }
    }
  }
  return g
}

/** Fastest corridor route; optionally restricted to a set of allowed corridors. */
export function route(r: Region, g: Graph, A: Anchor, B: Anchor, allowed?: Set<string>): Route | null {
  const access = (p: LatLng) => r.intersections
    .map((x) => ({ id: x.id, at: x.at, m: meters(p, x.at) * 1.3 }))
    .filter((x) => x.m < 4500).sort((p, q) => p.m - q.m).slice(0, 6)

  const extra = new Map<string, Edge[]>()
  extra.set('START', access(A.at).map((x) => ({ to: x.id, w: x.m / SPEED.local, corridor: null, coords: [A.at, x.at], m: x.m })))
  for (const x of access(B.at)) {
    const e: Edge = { to: 'END', w: x.m / SPEED.local, corridor: null, coords: [x.at, B.at], m: x.m }
    extra.set(x.id, [...(extra.get(x.id) ?? []), e])
  }
  const direct = meters(A.at, B.at) * 1.3
  if (direct < 3000) extra.get('START')!.push({ to: 'END', w: direct / SPEED.local, corridor: null, coords: [A.at, B.at], m: direct })

  const dist = new Map<string, number>([['START', 0]])
  const prev = new Map<string, { from: string; e: Edge }>()
  const done = new Set<string>()
  const queue = ['START']
  while (queue.length) {
    queue.sort((p, q) => dist.get(p)! - dist.get(q)!)
    const u = queue.shift()!
    if (done.has(u)) continue
    done.add(u)
    if (u === 'END') break
    for (const e of [...(g.get(u) ?? []), ...(extra.get(u) ?? [])]) {
      if (e.corridor && allowed && !allowed.has(e.corridor)) continue
      const nd = dist.get(u)! + e.w
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { from: u, e }); queue.push(e.to) }
    }
  }
  if (!prev.has('END')) return null

  const edges: Edge[] = []
  for (let n = 'END'; n !== 'START'; n = prev.get(n)!.from) edges.unshift(prev.get(n)!.e)
  // Merge consecutive edges on the same corridor into legs.
  const legs: Leg[] = []
  for (const e of edges) {
    const last = legs[legs.length - 1]
    if (last && last.corridor === e.corridor) { last.m += e.m; last.s += e.w; last.coords.push(...e.coords.slice(1)) }
    else legs.push({ corridor: e.corridor, m: e.m, s: e.w, coords: e.coords.slice() })
  }
  // A one-block hop along a cross street isn't a "primary route" worth naming.
  const corridors = [...new Set(legs.filter((l) => l.corridor && l.m > 600).map((l) => l.corridor!))]
  return { legs, corridors, seconds: dist.get('END')!, meters: legs.reduce((s, l) => s + l.m, 0) }
}

export interface RouteVerdict {
  ok: boolean
  optimal: Route
  mine: Route | null
  hits: string[]
  missed: string[]
  unused: string[]
  slowdown: number | null
}

export function evaluate(r: Region, g: Graph, A: Anchor, B: Anchor, picked: string[]): RouteVerdict | null {
  const optimal = route(r, g, A, B)
  if (!optimal) return null
  const mine = picked.length ? route(r, g, A, B, new Set(picked)) : null
  const usedByMine = new Set(mine?.corridors ?? [])
  const slowdown = mine ? mine.seconds / optimal.seconds : null
  // Accept any plan within 15% of optimal that actually uses the picked corridors.
  const ok = !!mine && slowdown! <= 1.15 && mine.corridors.length > 0
  return {
    ok, optimal, mine, slowdown,
    hits: picked.filter((p) => optimal.corridors.includes(p)),
    missed: optimal.corridors.filter((c) => !picked.includes(c)),
    unused: picked.filter((p) => !usedByMine.has(p)),
  }
}
