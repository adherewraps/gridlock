#!/usr/bin/env node
// Builds src/data/<region>.json from a region definition + live OpenStreetMap geometry.
//   node scripts/build-region.mjs --region=triad            (uses cached OSM response if present)
//   node scripts/build-region.mjs --region=triad --refresh  (re-downloads from Overpass)
//
// Everything quizzable (intersections, grid axes, district outlines) is DERIVED from
// real geometry, so adding a city only means writing a new region.*.mjs file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const regionArg = process.argv.find((a) => a.startsWith('--region='))?.split('=')[1] ?? 'triad'
const refresh = process.argv.includes('--refresh')
const def = (await import(`./region.${regionArg}.mjs`)).default

const [S, W, N, E] = def.bbox
const cacheDir = path.join(here, '.cache')
const outFile = path.join(here, '..', 'src', 'data', `${def.id}.json`)

// ── 1. Fetch ────────────────────────────────────────────────────────────────
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]
async function overpass(name, query) {
  const file = path.join(cacheDir, `${def.id}.${name}.json`)
  if (!refresh && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'))
  console.log(`Querying Overpass (${name})…`)
  for (let attempt = 0; attempt < 9; attempt++) {
    const ep = ENDPOINTS[attempt % ENDPOINTS.length]
    try {
      const res = await fetch(ep, {
        method: 'POST',
        headers: { 'User-Agent': 'geo-trainer-build/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240_000),
      })
      const text = await res.text()
      if (res.ok && text.startsWith('{')) {
        const json = JSON.parse(text)
        // Some mirrors lag months behind; stale tags silently drop whole corridors.
        const base = Date.parse(json.osm3s?.timestamp_osm_base ?? '')
        const ageDays = (Date.now() - base) / 86_400_000
        if (!(ageDays < 14)) {
          console.log(`  ${new URL(ep).host} data is ${Number.isFinite(ageDays) ? Math.round(ageDays) + ' days' : 'of unknown age'} old; trying another mirror`)
        } else {
          fs.mkdirSync(cacheDir, { recursive: true })
          fs.writeFileSync(file, text)
          console.log(`  ${new URL(ep).host} (data as of ${json.osm3s.timestamp_osm_base})`)
          return json
        }
      } else console.log(`  ${new URL(ep).host} busy (${res.status}); retrying`)
    } catch (e) {
      console.log(`  ${new URL(ep).host} failed (${e.message}); retrying`)
    }
    await new Promise((r) => setTimeout(r, 5000 + attempt * 3000))
  }
  throw new Error(`Overpass query "${name}" failed on all endpoints`)
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const specs = def.corridors.map((c) => ({
  c,
  refs: c.match?.refs ?? (c.match?.refHas ? [c.match.refHas] : []),
  refTrunk: !!c.match?.refTrunk,
  nameHas: c.match?.nameHas,
  names: c.names ?? [],
  // Full OSM names matched verbatim — needed where the direction IS the identity
  // (Seattle's "15th Avenue Northwest" vs "15th Avenue Northeast" are unrelated roads).
  exact: c.exact ?? [],
  within: c.within ?? null,
}))
const allRefs = [...new Set(specs.flatMap((s) => s.refs))].map(esc)
const allNames = [...new Set(specs.flatMap((s) => s.names))].map(esc)
const allExact = [...new Set(specs.flatMap((s) => s.exact))].map(esc)
const DIR = '(North|South|East|West|Northeast|Northwest|Southeast|Southwest)'
const nameAlternatives = [
  ...(allNames.length ? [`(${DIR} )?(${allNames.join('|')})( ${DIR})?`] : []),
  ...allExact,
]
const box = `${S},${W},${N},${E}`

const osm = await overpass('roads', `[out:json][timeout:240];
(
  ${allRefs.length ? `way["highway"~"^(motorway|trunk)$"]["ref"~"${allRefs.join('|')}"](${box});` : ''}
  ${nameAlternatives.length ? `way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]["name"~"^(${nameAlternatives.join('|')})$"](${box});` : ''}
);
out geom;`)
console.log(`Roads: ${osm.elements.length} ways`)

// ── 2. Assign ways to corridors (a way may carry several routes) ───────────
const DIRS = 'North|South|East|West|Northeast|Northwest|Southeast|Southwest'
const stripDir = (n) => n.replace(new RegExp(`^(${DIRS}) `), '').replace(new RegExp(` (${DIRS})$`), '')
const inBox = ([la, lo], [s, w, n, e]) => la >= s && la <= n && lo >= w && lo <= e
function corridorsFor(tags, mid) {
  const out = []
  for (const s of specs) {
    if (s.within && !inBox(mid, s.within)) continue
    const refOk = s.refs.length && (tags.highway === 'motorway' || (s.refTrunk && tags.highway === 'trunk')) &&
      (tags.ref ?? '').split(';').some((r) => s.refs.some((p) => r.trim() === p || r.trim().startsWith(p + ' ')))
    const nameOk = !!tags.name && (s.names.includes(stripDir(tags.name)) || s.exact.includes(tags.name))
    if (!refOk && !nameOk) continue
    if (s.nameHas && !(tags.name ?? '').includes(s.nameHas)) continue
    out.push(s.c)
  }
  return out
}

const round = (v) => Math.round(v * 1e5) / 1e5
const ways = new Map(def.corridors.map((c) => [c.id, []])) // id -> [{id, pts}]
for (const el of osm.elements) {
  if (el.type !== 'way' || !el.geometry) continue
  const pts = el.geometry.map((p) => [p.lat, p.lon])
  for (const c of corridorsFor(el.tags ?? {}, pts[Math.floor(pts.length / 2)])) ways.get(c.id).push({ id: el.id, pts })
}

// Join ways that share endpoints so lines render (and simplify) as long strokes.
function chain(list) {
  const key = (p) => `${p[0]},${p[1]}`
  const pool = list.map((w) => w.slice())
  const out = []
  while (pool.length) {
    let cur = pool.pop()
    let grew = true
    while (grew) {
      grew = false
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i]
        const [h, t] = [key(cur[0]), key(cur[cur.length - 1])]
        const [wh, wt] = [key(w[0]), key(w[w.length - 1])]
        if (t === wh) cur = cur.concat(w.slice(1))
        else if (t === wt) cur = cur.concat(w.slice(0, -1).reverse())
        else if (h === wt) cur = w.concat(cur.slice(1))
        else if (h === wh) cur = w.slice(1).reverse().concat(cur)
        else continue
        pool.splice(i, 1); grew = true; break
      }
    }
    out.push(cur)
  }
  return out
}

// Douglas–Peucker in degree space (fine at metro scale).
function simplify(pts, tol) {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    let maxD = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i], pts[a], pts[b])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  return pts.filter((_, i) => keep[i])
}
function segDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b
  const dx = x2 - x1, dy = y2 - y1
  const len = dx * dx + dy * dy
  let t = len ? ((x - x1) * dx + (y - y1) * dy) / len : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

const linesOf = (list) => chain(list.map((w) => w.pts)).map((l) => simplify(l, 0.00006).map(([a, b]) => [round(a), round(b)])).filter((l) => l.length > 1)
const geo = new Map()
for (const [id, ws] of ways) {
  geo.set(id, linesOf(ws))
}
const unmatched = [...ways].filter(([, ws]) => !ws.length).map(([id]) => id)
if (unmatched.length && !process.argv.includes('--allow-missing')) {
  console.error(`✗ No OSM ways matched: ${unmatched.join(', ')}. Check names/refs (or pass --allow-missing).`)
  process.exit(1)
}

// ── 3. Intersections ────────────────────────────────────────────────────────
const metersBetween = ([la1, lo1], [la2, lo2]) => {
  const k = Math.PI / 180, x = (lo2 - lo1) * k * Math.cos(((la1 + la2) / 2) * k), y = (la2 - la1) * k
  return Math.hypot(x, y) * 6371000
}
function segCross(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
  if (d === 0) return null
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
  const e = 1e-6
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]
}
function nearestOn(ls, p) {
  let best = null, bestD = Infinity
  for (const l of ls) for (let i = 0; i < l.length - 1; i++) {
    const [a, b] = [l[i], l[i + 1]]
    const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
    const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
    const q = [a[0] + t * dx, a[1] + t * dy]
    const d = metersBetween(p, q)
    if (d < bestD) { bestD = d; best = q }
  }
  return best
}
const bboxOf = (ls) => {
  let s = 90, w = 180, n = -90, e = -180
  for (const l of ls) for (const [a, b] of l) { s = Math.min(s, a); n = Math.max(n, a); w = Math.min(w, b); e = Math.max(e, b) }
  return [s, w, n, e]
}
const overlaps = (A, B) => A[0] <= B[2] && B[0] <= A[2] && A[1] <= B[3] && B[1] <= A[3]

const kind = Object.fromEntries(def.corridors.map((c) => [c.id, c.kind]))
const ids = def.corridors.map((c) => c.id).filter((id) => geo.get(id).length)
const boxes = new Map(ids.map((id) => [id, bboxOf(geo.get(id))]))
const wayIds = new Map(ids.map((id) => [id, new Set(ways.get(id).map((w) => w.id))]))
const intersections = []
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const [a, b] = [ids[i], ids[j]]
    if (!overlaps(boxes.get(a), boxes.get(b))) continue
    // Concurrent routes (e.g. I-40/I-85) share pavement: only test the parts they DON'T share,
    // otherwise every vertex of the overlap would register as a "junction".
    const shared = [...wayIds.get(a)].filter((w) => wayIds.get(b).has(w))
    const [LA, LB] = shared.length
      ? [linesOf(ways.get(a).filter((w) => !shared.includes(w.id))), linesOf(ways.get(b).filter((w) => !shared.includes(w.id)))]
      : [geo.get(a), geo.get(b)]
    const hits = []
    for (const la of LA) for (let x = 0; x < la.length - 1; x++)
      for (const lb of LB) for (let y = 0; y < lb.length - 1; y++) {
        const p = segCross(la[x], la[x + 1], lb[y], lb[y + 1])
        if (p) hits.push(p)
      }
    // T-junctions and freeway merges never geometrically cross, so also count a line END
    // that stops near the other road.
    const reach = kind[a] === 'freeway' && kind[b] === 'freeway' ? 900 : 120
    for (const [from, to] of [[LA, LB], [LB, LA]])
      for (const l of from) for (const end of [l[0], l[l.length - 1]]) {
        const near = to.length ? nearestOn(to, end) : null
        if (near && metersBetween(end, near) < reach) hits.push(near)
      }
    // Divided roads cross 2–4 times at one junction; freeway interchanges sprawl further.
    const radius = kind[a] === 'freeway' && kind[b] === 'freeway' ? 1800 : 500
    const clusters = []
    for (const h of hits) {
      const c = clusters.find((c) => metersBetween(c.c, h) < radius)
      if (c) { c.pts.push(h); c.c = [c.pts.reduce((s, p) => s + p[0], 0) / c.pts.length, c.pts.reduce((s, p) => s + p[1], 0) / c.pts.length] }
      else clusters.push({ pts: [h], c: h })
    }
    clusters.sort((p, q) => q.c[0] - p.c[0]) // north first
    const labels = [].concat(def.junctionNames?.[`${a}|${b}`] ?? def.junctionNames?.[`${b}|${a}`] ?? [])
    clusters.forEach((c, k) => {
      const label = labels[k] ?? (labels.length === 1 ? labels[0] : undefined)
      intersections.push({
        id: clusters.length > 1 ? `${a}|${b}#${k}` : `${a}|${b}`,
        a, b, at: [round(c.c[0]), round(c.c[1])],
        ...(label ? { label } : {}),
      })
    })
  }
}

// ── 4. Grid axes, crossing order ────────────────────────────────────────────
const median = (xs) => { const s = xs.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)] ?? null }
const axisValue = {}
for (const c of def.corridors) {
  if (!c.axis || !geo.get(c.id).length) continue
  const pts = geo.get(c.id).flat().filter((p) => !c.axisWithin || inBox(p, c.axisWithin))
  axisValue[c.id] = round(median(pts.map((p) => (c.axis === 'ew' ? p[0] : p[1]))))
}

function principalOrder(id) {
  const pts = geo.get(id).flat()
  const mx = pts.reduce((s, p) => s + p[1], 0) / pts.length, my = pts.reduce((s, p) => s + p[0], 0) / pts.length
  let sxx = 0, syy = 0, sxy = 0
  for (const [y, x] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my) }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return ([y, x]) => (x - mx) * Math.cos(ang) + (y - my) * Math.sin(ang)
}

const corridors = def.corridors.filter((c) => geo.get(c.id).length).map((c) => {
  const mine = intersections.filter((x) => x.a === c.id || x.b === c.id)
  const proj = c.axis === 'ew' ? (p) => p[1] : c.axis === 'ns' ? (p) => -p[0] : principalOrder(c.id)
  const crosses = [...new Set(mine.sort((p, q) => proj(p.at) - proj(q.at)).map((x) => (x.a === c.id ? x.b : x.a)))]
  return {
    id: c.id, name: c.name, kind: c.kind, axis: c.axis ?? null, desc: c.desc,
    group: c.group ?? null, color: c.color ?? null,
    aliases: [...new Set([c.name.toLowerCase(), ...(c.names ?? []).map((n) => n.toLowerCase()), ...(c.aliases ?? [])])],
    axisValue: axisValue[c.id] ?? null,
    bbox: boxes.get(c.id).map(round),
    crosses,
    lines: geo.get(c.id),
  }
})

// ── 5. Districts: arterial-bounded rectangles and/or real OSM boundaries ───
const osmNames = def.districts.filter((d) => d.osm).map((d) => d.osm)
const admin = osmNames.length
  ? await overpass('boundaries', `[out:json][timeout:180];
relation["boundary"="administrative"]["name"~"^(${osmNames.map(esc).join('|')})$"](${box});
out geom;`)
  : { elements: [] }

function boundaryRings(name) {
  const rel = admin.elements
    .filter((e) => e.type === 'relation' && e.tags?.name === name)
    .sort((p, q) => Number(p.tags.admin_level ?? 99) - Number(q.tags.admin_level ?? 99))
    .find((e) => e.tags.admin_level === '8') ?? admin.elements.find((e) => e.tags?.name === name)
  if (!rel) throw new Error(`No OSM boundary named "${name}"`)
  const outer = rel.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [p.lat, p.lon]))
  return chain(outer)
    .filter((r) => r.length > 3)
    .map((r) => simplify(r, 0.0003).map(([a, b]) => [round(a), round(b)]))
    .filter((r) => r.length > 3)
}

const nameOf = Object.fromEntries(def.corridors.map((c) => [c.id, c.name]))
const districts = def.districts.map((d) => {
  if (d.osm) {
    const rings = boundaryRings(d.osm)
    return { id: d.id, name: d.name, why: d.why, kind: d.kind ?? 'municipality', rings, rect: bboxOf(rings).map(round), boundedBy: { west: null, south: null, east: null, north: null } }
  }
  if (d.around) {
    // Square of ±halfKm around a verified neighborhood point (approximate area).
    const [la, lo] = d.around, h = d.halfKm ?? 0.8
    const dLat = h / 111.32, dLon = h / (111.32 * Math.cos((la * Math.PI) / 180))
    const [s, w, n, e] = [la - dLat, lo - dLon, la + dLat, lo + dLon].map(round)
    return { id: d.id, name: d.name, why: d.why, kind: 'area', rect: [s, w, n, e], rings: [[[s, w], [s, e], [n, e], [n, w]]], boundedBy: { west: null, south: null, east: null, north: null } }
  }
  const [w, s, e, n] = d.bounds.map((b) => (typeof b === 'number' ? b : axisValue[b]))
  if ([w, s, e, n].some((v) => v == null)) throw new Error(`District ${d.id} references a corridor without an axis`)
  const label = (b) => (typeof b === 'number' ? null : nameOf[b])
  return {
    id: d.id, name: d.name, why: d.why, kind: 'area',
    rect: [s, w, n, e],
    rings: [[[s, w], [s, e], [n, e], [n, w]]],
    boundedBy: { west: label(d.bounds[0]), south: label(d.bounds[1]), east: label(d.bounds[2]), north: label(d.bounds[3]) },
  }
})

const g = def.grid
const out = {
  region: {
    id: def.id, name: def.name, center: def.center, zoom: def.zoom, bbox: def.bbox, intro: def.intro, introTitle: def.introTitle,
    // Not every city has a single address origin (Seattle uses 8 directional sectors).
    origin: g ? {
      lat: axisValue[g.ew], lon: axisValue[g.ns], ew: g.ew, ns: g.ns,
      extent: g.extent ?? def.bbox, label: g.label, note: g.note, eastHint: g.eastHint, westHint: g.westHint,
    } : null,
  },
  corridors, intersections, districts,
  landmarks: def.landmarks,
  generatedAt: new Date().toISOString().slice(0, 10),
  attribution: '© OpenStreetMap contributors (ODbL)',
}
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(out))
const pts = corridors.reduce((s, c) => s + c.lines.reduce((t, l) => t + l.length, 0), 0)
console.log(`Wrote ${path.relative(process.cwd(), outFile)}: ${corridors.length} corridors, ${pts} pts, ${intersections.length} intersections, ${districts.length} districts, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`)
