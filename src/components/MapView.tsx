import L from 'leaflet'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import {
  CircleMarker, MapContainer, Marker, Pane, Polygon, Polyline, Rectangle, TileLayer, Tooltip, useMap, useMapEvents,
} from 'react-leaflet'
import { heatCells, scoreColor, type AnswerEvent } from '@/lib/progress'
import type { Question } from '@/lib/quiz'
import {
  QUADRANT_COLORS, corridorColor, corridorWeight, rectBounds,
  type Corridor, type LatLng, type Pin, type Quadrant, type Region,
} from '@/lib/region'
import type { RouteVerdict } from '@/lib/routing'

export interface Layers {
  roads: boolean
  sectors: boolean
  districts: boolean
  landmarks: boolean
  pins: boolean
  heat: boolean
  labels: boolean
}
export type Camera =
  | { kind: 'point'; at: LatLng; zoom: number; nonce: number }
  | { kind: 'bounds'; bounds: [LatLng, LatLng]; nonce: number; maxZoom?: number }

export interface QuizOverlay { question: Question; answered: null | { ok: boolean; picked: string } }
export interface RouteOverlay { A?: { name: string; at: LatLng }; B?: { name: string; at: LatLng }; verdict?: RouteVerdict | null }

interface Props {
  region: Region
  dark: boolean
  layers: Layers
  pins: Pin[]
  pinMode: boolean
  camera: Camera | null
  quiz: QuizOverlay | null
  route: RouteOverlay | null
  history: AnswerEvent[]
  selectedCorridor: string | null
  selectedDistrict: string | null
  onAddPin: (at: LatLng) => void
  onMovePin: (id: string, at: LatLng) => void
  onSelectCorridor: (id: string | null) => void
}

// Esri Canvas basemaps: keyless, and labels ship as a separate overlay — so hiding
// names for recall drills is just "don't render the Reference layer".
const ESRI = (layer: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${layer}/MapServer/tile/{z}/{y}/{x}`
const ATTR = 'Basemap &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, &copy; OpenStreetMap contributors'

function CameraController({ camera }: { camera: Camera | null }) {
  const map = useMap()
  useEffect(() => {
    if (!camera) return
    if (camera.kind === 'point') map.flyTo(camera.at, camera.zoom, { duration: 1.1 })
    else map.flyToBounds(camera.bounds, { duration: 1.1, padding: [60, 60], maxZoom: camera.maxZoom ?? 15 })
  }, [camera, map])
  return null
}

function ClickCatcher({ enabled, onClick }: { enabled: boolean; onClick: (at: LatLng) => void }) {
  useMapEvents({ click: (e) => { if (enabled) onClick([e.latlng.lat, e.latlng.lng]) } })
  return null
}

/** The Esri base bakes in street names from z15 — cap zoom while a question is open. */
function ZoomCap({ max }: { max: number }) {
  const map = useMap()
  useEffect(() => { map.setMaxZoom(max) }, [map, max])
  return null
}

/** Leaflet caches its container size; the collapsible sidebar changes it. */
function ResizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

const pinIcon = (name: string) =>
  L.divIcon({
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    html: `<div title="${name.replace(/"/g, '&quot;')}" style="filter:drop-shadow(0 3px 6px rgb(0 0 0 / .45))">
      <svg width="28" height="36" viewBox="0 0 28 36"><path d="M14 35s11-11.4 11-20A11 11 0 0 0 3 15c0 8.6 11 20 11 20z" fill="#22d3ee" stroke="#0e7490" stroke-width="1.5"/><circle cx="14" cy="14.5" r="4.5" fill="#0f172a"/></svg></div>`,
  })

const quizPointIcon = L.divIcon({
  className: '',
  iconSize: [60, 60],
  iconAnchor: [30, 30],
  html: `<svg width="60" height="60" viewBox="0 0 60 60" style="overflow:visible">
    <circle class="gl-pulse" cx="30" cy="30" r="14" fill="none" stroke="#22d3ee" stroke-width="3"/>
    <circle cx="30" cy="30" r="9" fill="#22d3ee" stroke="#0f172a" stroke-width="3"/>
    <circle cx="30" cy="30" r="3" fill="#0f172a"/></svg>`,
})

const abIcon = (letter: string, color: string) =>
  L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="width:30px;height:30px;border-radius:999px;background:${color};color:#0f172a;display:grid;place-items:center;font:700 14px Inter,sans-serif;border:3px solid #0f172a;box-shadow:0 4px 14px rgb(0 0 0/.45)">${letter}</div>`,
  })

function CorridorInspect({ region, c }: { region: Region; c: Corridor }) {
  const fwys = c.crosses.filter((id) => region.corridorById.get(id)?.kind === 'freeway')
  const arts = c.crosses.filter((id) => region.corridorById.get(id)?.kind !== 'freeway')
  const n = (id: string) => region.corridorById.get(id)!.name
  return (
    <div className="space-y-1 text-xs">
      <div className="text-sm font-semibold">{c.name}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {c.kind === 'freeway' ? 'Freeway' : c.axis === 'ew' ? 'East–west arterial' : c.axis === 'ns' ? 'North–south arterial' : 'Diagonal arterial'}
      </div>
      {fwys.length > 0 && <div><span className="text-muted-foreground">Freeway links:</span> {fwys.map(n).join(' → ')}</div>}
      {arts.length > 0 && (
        <div><span className="text-muted-foreground">Crosses:</span> {arts.slice(0, 8).map(n).join(' · ')}{arts.length > 8 ? ` +${arts.length - 8}` : ''}</div>
      )}
    </div>
  )
}

export function MapView(props: Props) {
  const { region, dark, layers, quiz, route } = props
  const quizActive = !!quiz
  const unanswered = !!quiz && !quiz.answered
  const zeroLines = new Set([region.region.origin.ew, region.region.origin.ns])
  const revealSet = new Set(quiz?.answered ? quiz.question.reveal.corridors : [])
  const routeSet = new Set(route?.verdict?.optimal.corridors ?? [])

  // During recall, names on the basemap would give the answer away.
  const showLabels = layers.labels && !quizActive
  const theme = dark ? 'Dark' : 'Light'
  const heat = useMemo(() => (layers.heat ? heatCells(props.history) : []), [layers.heat, props.history])
  const sorted = useMemo(
    () => region.corridors.slice().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'freeway' ? 1 : -1)),
    [region],
  )
  const mapRef = useRef<L.Map | null>(null)

  return (
    <MapContainer
      ref={mapRef}
      center={region.region.center}
      zoom={region.region.zoom}
      minZoom={9}
      maxZoom={17}
      zoomControl={false}
      className="h-full w-full"
      preferCanvas={false}
    >
      <TileLayer key={theme} url={ESRI(`World_${theme}_Gray_Base`)} maxNativeZoom={16} attribution={`${ATTR} · Roads ${region.attribution}`} />
      {showLabels && (
        <Pane name="labels" style={{ zIndex: 460, pointerEvents: 'none' }}>
          <TileLayer key={`l${theme}`} url={ESRI(`World_${theme}_Gray_Reference`)} maxNativeZoom={16} />
        </Pane>
      )}
      {/* ZoomCap must run before CameraController: setMaxZoom snaps zoom and would cancel a flyTo. */}
      <ZoomCap max={unanswered ? 14 : 17} />
      <CameraController camera={props.camera} />
      <ClickCatcher enabled={props.pinMode} onClick={props.onAddPin} />
      <ResizeWatcher />

      {/* Spatial mastery heatmap */}
      {heat.map((c, i) => (
        <Rectangle key={`h${i}`} bounds={rectBounds(c.rect)} interactive={false}
          pathOptions={{ stroke: false, fillColor: scoreColor(c.score), fillOpacity: Math.min(0.55, 0.18 + c.n * 0.06) }} />
      ))}

      {/* Address quadrants */}
      {layers.sectors && !unanswered && (Object.keys(region.quadrants) as Quadrant[]).map((q) => (
        <Rectangle key={q} bounds={rectBounds(region.quadrants[q])}
          pathOptions={{ color: QUADRANT_COLORS[q], weight: 1, opacity: 0.5, fillColor: QUADRANT_COLORS[q], fillOpacity: dark ? 0.07 : 0.1, dashArray: '6 6' }}>
          <Tooltip sticky className="gl-tip">
            <div className="text-sm font-semibold">{q} quadrant</div>
            <div className="text-xs text-muted-foreground">
              {q[0] === 'N' ? 'North' : 'South'} of {region.corridorById.get(region.region.origin.ew)?.name},{' '}
              {q[1] === 'E' ? 'east' : 'west'} of {region.corridorById.get(region.region.origin.ns)?.name}.{' '}
              {(q[1] === 'E' ? region.region.origin.eastHint : region.region.origin.westHint) ?? ''}
            </div>
          </Tooltip>
        </Rectangle>
      ))}

      {/* Districts */}
      {layers.districts && !unanswered && region.districts.map((d) => {
        const sel = props.selectedDistrict === d.id
        const inside = region.landmarks.filter((l) => region.inDistrict(l.at, d))
        const town = d.kind === 'municipality'
        return (
          <Polygon key={d.id} positions={d.rings}
            pathOptions={{
              color: sel ? '#22d3ee' : town ? (dark ? '#64748b' : '#94a3b8') : dark ? '#cbd5e1' : '#475569',
              weight: sel ? 3 : town ? 1 : 1.5, opacity: sel ? 1 : 0.7, dashArray: town && !sel ? '4 4' : undefined,
              fillColor: town ? '#94a3b8' : '#22d3ee', fillOpacity: sel ? 0.16 : town ? 0.025 : 0.06,
            }}>
            <Tooltip sticky className="gl-tip">
              <div className="space-y-1 text-xs">
                <div className="text-sm font-semibold">{d.name}</div>
                <div className="text-muted-foreground">{d.why}</div>
                {d.kind === 'area' && Object.values(d.boundedBy).some(Boolean) && <div>
                  <span className="text-muted-foreground">Bounds:</span>{' '}
                  {[d.boundedBy.north && `N ${d.boundedBy.north}`, d.boundedBy.south && `S ${d.boundedBy.south}`, d.boundedBy.west && `W ${d.boundedBy.west}`, d.boundedBy.east && `E ${d.boundedBy.east}`].filter(Boolean).join(' · ')}
                </div>}
                {inside.length > 0 && <div><span className="text-muted-foreground">Anchors:</span> {inside.map((l) => l.name).join(', ')}</div>}
              </div>
            </Tooltip>
          </Polygon>
        )
      })}

      {/* Corridors. Wide invisible hit-lines make hovering forgiving. */}
      {layers.roads && (
        <Pane name="roads" style={{ zIndex: 450 }}>
          {sorted.map((c) => {
            const revealed = revealSet.has(c.id) || routeSet.has(c.id)
            const selected = props.selectedCorridor === c.id
            const neutral = quizActive && !revealed
            const color = neutral ? (dark ? '#475569' : '#94a3b8') : corridorColor(c, dark)
            const w = corridorWeight(c, zeroLines.has(c.id)) + (revealed || selected ? 3 : 0)
            const dim = (props.selectedCorridor && !selected) || (route?.verdict && !revealed)
            return (
              <Fragment key={c.id}>
                {selected && <Polyline positions={c.lines} interactive={false} pathOptions={{ color, weight: w + 10, opacity: 0.25 }} />}
                <Polyline positions={c.lines} interactive={false}
                  pathOptions={{ color, weight: w, opacity: dim ? 0.3 : neutral ? 0.55 : 0.92, lineCap: 'round', dashArray: zeroLines.has(c.id) && !neutral ? '1 0' : undefined }} />
                {!quizActive && (
                  <Polyline positions={c.lines} pathOptions={{ color: '#000', weight: 16, opacity: 0 }}
                    eventHandlers={{ click: () => props.onSelectCorridor(c.id) }}>
                    <Tooltip sticky className="gl-tip"><CorridorInspect region={region} c={c} /></Tooltip>
                  </Polyline>
                )}
              </Fragment>
            )
          })}
        </Pane>
      )}

      {/* Landmarks */}
      {layers.landmarks && !unanswered && region.landmarks.map((l) => (
        <CircleMarker key={l.id} center={l.at} radius={6}
          pathOptions={{ color: dark ? '#0f172a' : '#fff', weight: 2, fillColor: '#fbbf24', fillOpacity: 1 }}>
          <Tooltip direction="top" offset={[0, -6]} className="gl-tip">
            <div className="text-sm font-semibold">{l.name}</div>
            <div className="text-xs text-muted-foreground">{region.describe(l.at)}</div>
            <div className="text-xs">
              Near: {region.corridorsNear(l.at, 1300).slice(0, 3).map((x) => x.corridor.name).join(', ') || '—'}
            </div>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Custom pins */}
      {layers.pins && props.pins.map((p) => (
        <Marker key={p.id} position={p.at} icon={pinIcon(p.name)} draggable={!unanswered}
          eventHandlers={{ dragend: (e) => { const ll = (e.target as L.Marker).getLatLng(); props.onMovePin(p.id, [ll.lat, ll.lng]) } }}>
          <Tooltip direction="top" offset={[0, -30]} className="gl-tip">
            <div className="text-sm font-semibold">{p.name}</div>
            <div className="text-xs text-muted-foreground">{region.describe(p.at)} · drag to move</div>
          </Tooltip>
        </Marker>
      ))}

      {/* Quiz overlays */}
      {quiz && <QuizLayer q={quiz} dark={dark} />}

      {/* Route overlays sit above the road network */}
      <Pane name="route" style={{ zIndex: 455 }}>
      {route?.verdict?.mine && !route.verdict.ok && route.verdict.mine.legs.map((l, i) => (
        <Polyline key={`m${i}`} positions={l.coords} pathOptions={{ color: '#f43f5e', weight: 5, opacity: 0.85, dashArray: '2 10', lineCap: 'round' }} />
      ))}
      {route?.verdict && (route.verdict.ok && route.verdict.mine ? route.verdict.mine : route.verdict.optimal).legs.map((l, i) => (
        <Polyline key={`o${i}`} positions={l.coords}
          pathOptions={{ color: l.corridor ? '#34d399' : '#94a3b8', weight: l.corridor ? 7 : 3, opacity: 0.95, dashArray: l.corridor ? undefined : '4 8', lineCap: 'round' }} />
      ))}
      </Pane>
      {route?.A && <Marker position={route.A.at} icon={abIcon('A', '#22d3ee')}><Tooltip direction="top" offset={[0, -14]} className="gl-tip">{route.A.name}</Tooltip></Marker>}
      {route?.B && <Marker position={route.B.at} icon={abIcon('B', '#34d399')}><Tooltip direction="top" offset={[0, -14]} className="gl-tip">{route.B.name}</Tooltip></Marker>}
    </MapContainer>
  )
}

function QuizLayer({ q, dark }: { q: QuizOverlay; dark: boolean }) {
  const { question, answered } = q
  const f = question.focus
  const tint = answered ? (answered.ok ? '#34d399' : '#f43f5e') : '#22d3ee'
  return (
    <>
      {f.kind === 'point' && <Marker position={f.at} icon={quizPointIcon} interactive={false} />}
      {f.kind === 'rect' && (
        <Polygon positions={f.rings ?? [[[f.rect[0], f.rect[1]], [f.rect[0], f.rect[3]], [f.rect[2], f.rect[3]], [f.rect[2], f.rect[1]]]]} interactive={false}
          pathOptions={{ color: tint, weight: 3, dashArray: answered ? undefined : '10 8', fillColor: tint, fillOpacity: dark ? 0.12 : 0.18 }} />
      )}
      {f.kind === 'pair' && (
        <>
          <Polyline positions={[f.a.at, f.b.at]} interactive={false} pathOptions={{ color: '#94a3b8', weight: 1.5, dashArray: '4 8' }} />
          <Marker position={f.a.at} icon={abIcon('A', '#22d3ee')} interactive={false}>
            <Tooltip permanent direction="top" offset={[0, -16]} className="gl-label">{f.a.name}</Tooltip>
          </Marker>
          <Marker position={f.b.at} icon={abIcon('B', '#34d399')} interactive={false}>
            <Tooltip permanent direction="top" offset={[0, -16]} className="gl-label">{f.b.name}</Tooltip>
          </Marker>
        </>
      )}
      {answered && (
        <CircleMarker key={question.key} center={question.reveal.labelAt} radius={1} interactive={false} pathOptions={{ opacity: 0, fillOpacity: 0 }}>
          <Tooltip permanent direction="right" offset={[18, 0]} className="gl-label">{question.reveal.label}</Tooltip>
        </CircleMarker>
      )}
    </>
  )
}
