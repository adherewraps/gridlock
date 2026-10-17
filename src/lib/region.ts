// Region model + derived spatial indices. The raw JSON is produced by scripts/build-region.mjs.

export type LatLng = [number, number]
export type Rect = [number, number, number, number] // south, west, north, east

export interface Corridor {
  id: string
  name: string
  kind: 'freeway' | 'arterial'
  axis: 'ew' | 'ns' | null
  desc: string
  group: string | null
  color: string | null
  aliases: string[]
  axisValue: number | null
  bbox: Rect
  crosses: string[]
  lines: LatLng[][]
}
export interface Intersection { id: string; a: string; b: string; at: LatLng; label?: string }
export interface District {
  id: string
  name: string
  why: string
  kind: 'area' | 'municipality'
  rect: Rect
  rings: LatLng[][]
  boundedBy: { west: string | null; south: string | null; east: string | null; north: string | null }
}
export interface Landmark { id: string; name: string; type: string; at: LatLng }
export interface Pin { id: string; name: string; at: LatLng }
export type Quadrant = 'NW' | 'NE' | 'SW' | 'SE'

export interface GridOrigin {
  lat: number
  lon: number
  ew: string
  ns: string
  /** Area where the address grid applies; quadrants outside it are meaningless. */
  extent: Rect
  label: string
  note: string
  eastHint?: string
  westHint?: string
}

export interface RegionData {
  region: {
    id: string; name: string; center: LatLng; zoom: number; bbox: Rect
    intro?: string; introTitle?: string
    /** Null for cities without a single address origin. */
    origin: GridOrigin | null
  }
  corridors: Corridor[]
  intersections: Intersection[]
  districts: District[]
  landmarks: Landmark[]
  attribution: string
  generatedAt: string
}

/** Anything the user can travel between or be quizzed on as an endpoint. */
export interface Anchor { id: string; name: string; at: LatLng; custom?: boolean }

// ── Geometry ──────────────────────────────────────────────────────────────
const RAD = Math.PI / 180
export function meters([la1, lo1]: LatLng, [la2, lo2]: LatLng) {
  const x = (lo2 - lo1) * RAD * Math.cos(((la1 + la2) / 2) * RAD)
  const y = (la2 - la1) * RAD
  return Math.hypot(x, y) * 6371000
}
export const miles = (m: number) => m / 1609.34
export const fmtMi = (m: number) => `${miles(m).toFixed(miles(m) < 10 ? 1 : 0)} mi`

export function nearestOnLines(lines: LatLng[][], p: LatLng): { at: LatLng; d: number } {
  let best: LatLng = lines[0]?.[0] ?? p
  let bestD = Infinity
  for (const l of lines) {
    for (let i = 0; i < l.length - 1; i++) {
      const [a, b] = [l[i], l[i + 1]]
      const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
      const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
      const q: LatLng = [a[0] + t * dx, a[1] + t * dy]
      const d = meters(p, q)
      if (d < bestD) { bestD = d; best = q }
    }
  }
  return { at: best, d: bestD }
}

export const inRect = ([la, lo]: LatLng, [s, w, n, e]: Rect) => la >= s && la <= n && lo >= w && lo <= e
export const rectCenter = ([s, w, n, e]: Rect): LatLng => [(s + n) / 2, (w + e) / 2]
export const rectBounds = ([s, w, n, e]: Rect): [LatLng, LatLng] => [[s, w], [n, e]]

/** Ray casting; a point inside ANY outer ring counts (municipalities can be multipart). */
export function inRings(p: LatLng, rings: LatLng[][]): boolean {
  const [y, x] = p
  return rings.some((ring) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i], [yj, xj] = ring[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  })
}

/**
 * A point guaranteed inside the district, as close to its bbox center as possible.
 * Irregular town limits are often concave, so the bbox center can fall outside.
 */
const centerCache = new WeakMap<District, LatLng>()
export function districtCenter(d: District): LatLng {
  const cached = centerCache.get(d)
  if (cached) return cached
  const c = rectCenter(d.rect)
  let best: LatLng = inRings(c, d.rings) ? c : d.rings[0][0]
  if (best !== c) {
    const [s, w, n, e] = d.rect
    let bestD = Infinity
    for (let i = 1; i < 24; i++) for (let j = 1; j < 24; j++) {
      const p: LatLng = [s + ((n - s) * i) / 24, w + ((e - w) * j) / 24]
      const dist = meters(p, c)
      if (dist < bestD && inRings(p, d.rings)) { bestD = dist; best = p }
    }
  }
  centerCache.set(d, best)
  return best
}

// ── Indexed region ────────────────────────────────────────────────────────
export interface Region extends RegionData {
  corridorById: Map<string, Corridor>
  intersectionById: Map<string, Intersection>
  districtById: Map<string, District>
  /** Empty when the region has no address origin. */
  quadrants: Partial<Record<Quadrant, Rect>>
  quadrantOf: (p: LatLng) => Quadrant | null
  /** Most specific district containing p (areas are listed before municipalities). */
  districtAt: (p: LatLng) => District | undefined
  districtsAt: (p: LatLng) => District[]
  inDistrict: (p: LatLng, d: District) => boolean
  ixLabel: (ix: Intersection) => string
  /** Corridors within `radius` meters of a point, closest first. */
  corridorsNear: (p: LatLng, radius: number) => { corridor: Corridor; d: number; at: LatLng }[]
  /** Short human description of where a point sits ("Fisher Park, Greensboro · NE"). */
  describe: (p: LatLng) => string
}

export function indexRegion(data: RegionData): Region {
  const corridorById = new Map(data.corridors.map((c) => [c.id, c]))
  const intersectionById = new Map(data.intersections.map((x) => [x.id, x]))
  const districtById = new Map(data.districts.map((d) => [d.id, d]))
  const { origin } = data.region
  const quadrants: Partial<Record<Quadrant, Rect>> = {}
  if (origin) {
    const [S, W, N, E] = origin.extent
    quadrants.NW = [origin.lat, W, N, origin.lon]
    quadrants.NE = [origin.lat, origin.lon, N, E]
    quadrants.SW = [S, W, origin.lat, origin.lon]
    quadrants.SE = [S, origin.lon, origin.lat, E]
  }
  const quadrantOf = (p: LatLng): Quadrant | null =>
    origin && inRect(p, origin.extent) ? (`${p[0] >= origin.lat ? 'N' : 'S'}${p[1] >= origin.lon ? 'E' : 'W'}` as Quadrant) : null
  const inDistrict = (p: LatLng, d: District) => inRect(p, d.rect) && inRings(p, d.rings)
  const districtsAt = (p: LatLng) => data.districts.filter((d) => inDistrict(p, d))
  const districtAt = (p: LatLng) => data.districts.find((d) => inDistrict(p, d))
  const name = (id: string) => corridorById.get(id)?.name ?? id
  const ixLabel = (ix: Intersection) => {
    const base = `${name(ix.a)} & ${name(ix.b)}`
    return ix.label ? `${ix.label} (${base})` : base
  }

  // Corridor proximity is the hot path for quiz generation — cache per point.
  const nearCache = new Map<string, { corridor: Corridor; d: number; at: LatLng }[]>()
  const corridorsNear = (p: LatLng, radius: number) => {
    const key = `${p[0].toFixed(5)},${p[1].toFixed(5)}`
    let all = nearCache.get(key)
    if (!all) {
      all = data.corridors
        .map((corridor) => ({ corridor, ...nearestOnLines(corridor.lines, p) }))
        .sort((a, b) => a.d - b.d)
      nearCache.set(key, all)
    }
    return all.filter((x) => x.d <= radius)
  }
  const describe = (p: LatLng) => {
    const parts = districtsAt(p).map((d) => d.name)
    const q = quadrantOf(p)
    return [parts.join(', '), q && `${q} quadrant`].filter(Boolean).join(' · ') || 'Outside mapped districts'
  }

  return {
    ...data, corridorById, intersectionById, districtById, quadrants,
    quadrantOf, districtAt, districtsAt, inDistrict, ixLabel, corridorsNear, describe,
  }
}

// ── Styling ───────────────────────────────────────────────────────────────
// Freeways each get a signature color (set per region) — color is a powerful memory cue.
const FALLBACK = ['#f43f5e', '#f59e0b', '#a855f7', '#3b82f6', '#ec4899', '#eab308', '#14b8a6', '#fb923c', '#84cc16', '#06b6d4']
export function corridorColor(c: Corridor, dark: boolean): string {
  if (c.color) return c.color
  if (c.kind === 'freeway') return FALLBACK[[...c.id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % FALLBACK.length]
  if (c.axis === 'ew') return dark ? '#67e8f9' : '#0e7490'
  if (c.axis === 'ns') return dark ? '#a5b4fc' : '#4338ca'
  return dark ? '#5eead4' : '#0f766e'
}
export function corridorWeight(c: Corridor, zeroLine: boolean): number {
  if (c.kind === 'freeway') return 5
  return zeroLine ? 3.75 : 2.25
}

export const QUADRANT_COLORS: Record<Quadrant, string> = { NW: '#38bdf8', NE: '#a78bfa', SW: '#fbbf24', SE: '#34d399' }
