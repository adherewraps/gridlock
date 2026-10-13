import { BarChart3, Compass, GraduationCap, Route as RouteIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapView, type Camera, type Layers } from '@/components/MapView'
import { AnalyticsPanel } from '@/components/panels/AnalyticsPanel'
import { ExplorerPanel } from '@/components/panels/ExplorerPanel'
import { QuizPanel } from '@/components/panels/QuizPanel'
import { RoutePanel, type RouteState } from '@/components/panels/RoutePanel'
import { TopBar, type SearchHit } from '@/components/TopBar'
import { Skeleton } from '@/components/ui/skeleton'
import { NativeSelect } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useQuizSession } from '@/hooks/useQuizSession'
import { useRegion } from '@/hooks/useRegion'
import { DEFAULT_REGION, REGIONS, type RegionId } from '@/data/regions'
import { emptyProgress, masteryScore, recordAnswer, weakKeys, type Progress } from '@/lib/progress'
import type { Question } from '@/lib/quiz'
import { rectBounds, type Anchor, type LatLng, type Pin, type Rect } from '@/lib/region'
import { buildGraph, evaluate } from '@/lib/routing'
import { cn } from '@/lib/utils'

type Tab = 'explorer' | 'quiz' | 'route' | 'analytics'
const DEFAULT_LAYERS: Layers = { roads: true, sectors: false, districts: true, landmarks: true, pins: true, heat: false, labels: true }
const EMPTY_ROUTE: RouteState = { startId: '', endId: '', picked: [], verdict: null }

export default function App() {
  const [dark, setDark] = useLocalStorage('dark', true)
  const [regionId, setRegionId] = useLocalStorage<RegionId>('region', DEFAULT_REGION)
  const valid = REGIONS.some((r) => r.id === regionId) ? regionId : DEFAULT_REGION
  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  // Keyed remount: every region gets its own pins, progress and camera from scratch.
  return <Workspace key={valid} regionId={valid} setRegionId={setRegionId} dark={dark} setDark={setDark} />
}

interface WorkspaceProps { regionId: RegionId; setRegionId: (id: RegionId) => void; dark: boolean; setDark: (v: boolean) => void }

function Workspace({ regionId, setRegionId, dark, setDark }: WorkspaceProps) {
  const region = useRegion(regionId)
  const [tab, setTab] = useLocalStorage<Tab>('tab', 'explorer')
  const [layers, setLayers] = useLocalStorage<Layers>('layers', DEFAULT_LAYERS)
  const [pins, setPins] = useLocalStorage<Pin[]>(`pins:${regionId}`, [])
  const [progress, setProgress] = useLocalStorage<Progress>(`progress:${regionId}`, emptyProgress)
  const [textMode, setTextMode] = useLocalStorage('textMode', false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [pinMode, setPinMode] = useState(false)
  const [camera, setCamera] = useState<Camera | null>(null)
  const [selectedCorridor, setSelectedCorridor] = useState<string | null>(null)
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null)
  const [routeState, setRouteState] = useState<RouteState>(EMPTY_ROUTE)
  const [flash, setFlash] = useState<{ ok: boolean; n: number } | null>(null)

  const anchors = useMemo<Anchor[]>(
    () => [...(region?.landmarks ?? []), ...pins.map((p) => ({ ...p, custom: true }))],
    [region, pins],
  )
  const graph = useMemo(() => (region ? buildGraph(region) : null), [region])
  const mastery = useMemo(() => masteryScore(progress), [progress])
  const weakCount = useMemo(() => weakKeys(progress).length, [progress])

  // ── Camera helpers ───────────────────────────────────────────────────
  const flyTo = useCallback((at: LatLng, zoom = 14) => setCamera({ kind: 'point', at, zoom, nonce: Date.now() }), [])
  const flyToRect = useCallback((r: Rect, districtId?: string) => {
    setCamera({ kind: 'bounds', bounds: rectBounds(r), nonce: Date.now() })
    if (districtId) setSelectedDistrict(districtId)
  }, [])
  const flyFocus = useCallback((f: Question['focus'] | { kind: 'zoomTo'; at: LatLng; zoom: number }) => {
    if (f.kind === 'point' || f.kind === 'zoomTo') setCamera({ kind: 'point', at: f.at, zoom: f.zoom, nonce: Date.now() })
    else if (f.kind === 'rect') setCamera({ kind: 'bounds', bounds: rectBounds(f.rect), nonce: Date.now() })
    else setCamera({ kind: 'bounds', bounds: [f.a.at, f.b.at], nonce: Date.now(), maxZoom: 14 })
  }, [])

  const doFlash = useCallback((ok: boolean) => setFlash({ ok, n: Date.now() }), [])
  const quiz = useQuizSession({ region, anchors, progress, setProgress, fly: flyFocus, flash: doFlash })
  const inQuestion = tab === 'quiz' && !!quiz.session?.question

  // ── Pins ─────────────────────────────────────────────────────────────
  const addPin = useCallback((at: LatLng) => {
    setPins((ps) => [...ps, { id: `pin-${Date.now().toString(36)}`, name: ps.length === 0 ? 'Home' : ps.length === 1 ? 'Office' : `Pin ${ps.length + 1}`, at }])
  }, [setPins])

  // ── Route builder ────────────────────────────────────────────────────
  const A = anchors.find((a) => a.id === routeState.startId)
  const B = anchors.find((a) => a.id === routeState.endId)
  const checkRoute = () => {
    if (!region || !graph || !A || !B) return
    const verdict = evaluate(region, graph, A, B, routeState.picked)
    setRouteState({ ...routeState, verdict })
    if (!verdict) return
    doFlash(verdict.ok)
    setProgress((p) => recordAnswer(p, { key: `rt:${A.id}:${B.id}`, type: 'route', at: [(A.at[0] + B.at[0]) / 2, (A.at[1] + B.at[1]) / 2], ok: verdict.ok }))
    const pts = verdict.optimal.legs.flatMap((l) => l.coords)
    const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1])
    setCamera({ kind: 'bounds', bounds: [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], nonce: Date.now() })
  }
  const updateRoute = (next: RouteState) => {
    const [a, b] = [anchors.find((x) => x.id === next.startId), anchors.find((x) => x.id === next.endId)]
    if (a && b && (next.startId !== routeState.startId || next.endId !== routeState.endId))
      setCamera({ kind: 'bounds', bounds: [a.at, b.at], nonce: Date.now(), maxZoom: 13 })
    setRouteState(next)
  }

  const onSearch = (h: SearchHit) => {
    if (!region) return
    if (h.kind === 'corridor') { setSelectedCorridor(h.id); flyToRect(region.corridorById.get(h.id)!.bbox); setTab('explorer') }
    else if (h.kind === 'district') flyToRect(h.rect, h.id)
    else flyTo(h.at, 15)
  }

  // The heatmap always shows on Analytics; otherwise it follows the layer toggle.
  const effectiveLayers = { ...layers, heat: layers.heat || tab === 'analytics' }

  return (
    <TooltipProvider>
      <div className={cn('flex h-full flex-col overflow-hidden md:flex-row', pinMode && 'pin-mode')}>
        {/* Map canvas */}
        <main className="relative min-h-[48vh] flex-1">
          {region ? (
            <MapView
              region={region}
              dark={dark}
              layers={effectiveLayers}
              pins={pins}
              pinMode={pinMode}
              camera={camera}
              quiz={inQuestion ? { question: quiz.session!.question!, answered: quiz.session!.answered } : null}
              route={tab === 'route' ? { A, B, verdict: routeState.verdict } : null}
              history={progress.history}
              selectedCorridor={tab === 'explorer' ? selectedCorridor : null}
              selectedDistrict={selectedDistrict}
              onAddPin={addPin}
              onMovePin={(id, at) => setPins((ps) => ps.map((p) => (p.id === id ? { ...p, at } : p)))}
              onSelectCorridor={(id) => { setSelectedCorridor(id); setTab('explorer') }}
            />
          ) : (
            <div className="grid h-full place-items-center bg-[var(--map-bg)]">
              <div className="flex flex-col items-center gap-3 text-muted-foreground">
                <div className="size-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                <span className="text-sm">Loading road network…</span>
              </div>
            </div>
          )}
          {flash && (
            <div key={flash.n} className={cn('pointer-events-none absolute inset-0 z-[900]', flash.ok ? 'animate-flash-ok' : 'animate-flash-bad')} />
          )}
          <TopBar
            region={region}
            pins={pins}
            layers={layers}
            setLayers={setLayers}
            mastery={mastery}
            streak={progress.streak}
            dark={dark}
            toggleDark={() => setDark(!dark)}
            sidebarOpen={sidebarOpen}
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            onPick={onSearch}
            quizLocked={inQuestion && !quiz.session?.answered}
          />
          {pinMode && (
            <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xl">
              Click the map to drop a pin · <button className="cursor-pointer underline" onClick={() => setPinMode(false)}>done</button>
            </div>
          )}
        </main>

        {/* Sidebar */}
        <aside
          className={cn(
            'flex flex-col border-t bg-background transition-[width,height] duration-300 md:border-l md:border-t-0',
            sidebarOpen ? 'h-[52vh] md:h-auto md:w-[30%] md:min-w-[360px] md:max-w-[480px]' : 'h-0 md:h-auto md:w-0 overflow-hidden',
          )}
        >
          <Tabs value={tab} onValueChange={(v) => { setTab(v as Tab); setPinMode(false) }} className="flex min-h-0 flex-1 flex-col">
            <div className="border-b p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <NativeSelect aria-label="Region" value={regionId} onChange={(e) => setRegionId(e.target.value as RegionId)}
                  className="h-8 w-auto border-transparent bg-transparent pl-0 text-sm font-semibold tracking-tight hover:bg-accent">
                  {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </NativeSelect>
                <span className="shrink-0 text-[11px] text-muted-foreground">{region ? `${region.corridors.length} corridors · ${region.intersections.length} junctions` : ''}</span>
              </div>
              <TabsList className="w-full">
                <TabsTrigger value="explorer"><Compass />Explorer</TabsTrigger>
                <TabsTrigger value="quiz"><GraduationCap />Quiz</TabsTrigger>
                <TabsTrigger value="route"><RouteIcon />Route</TabsTrigger>
                <TabsTrigger value="analytics"><BarChart3 />Analytics</TabsTrigger>
              </TabsList>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!region ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-64 w-full" />
                </div>
              ) : (
                <>
                  <TabsContent value="explorer">
                    <ExplorerPanel
                      region={region} dark={dark} layers={layers} setLayers={setLayers}
                      pins={pins} pinMode={pinMode} setPinMode={setPinMode}
                      renamePin={(id, name) => setPins((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)))}
                      deletePin={(id) => setPins((ps) => ps.filter((p) => p.id !== id))}
                      selectedCorridor={selectedCorridor} selectCorridor={setSelectedCorridor}
                      flyTo={flyTo} flyToRect={flyToRect}
                    />
                  </TabsContent>
                  <TabsContent value="quiz">
                    <QuizPanel
                      region={region} session={quiz.session} streak={progress.streak} bestStreak={progress.bestStreak}
                      weakCount={weakCount} textMode={textMode} setTextMode={setTextMode}
                      start={quiz.start} answer={quiz.answer} next={quiz.next} quit={quiz.quit}
                    />
                  </TabsContent>
                  <TabsContent value="route">
                    <RoutePanel region={region} dark={dark} anchors={anchors} state={routeState} setState={updateRoute} check={checkRoute} />
                  </TabsContent>
                  <TabsContent value="analytics">
                    <AnalyticsPanel
                      region={region} anchors={anchors} progress={progress} mastery={mastery}
                      startWeak={() => { setTab('quiz'); quiz.start('weak') }}
                      reset={() => setProgress(emptyProgress())}
                      flyToRect={flyToRect} flyTo={flyTo}
                    />
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        </aside>
      </div>
    </TooltipProvider>
  )
}
