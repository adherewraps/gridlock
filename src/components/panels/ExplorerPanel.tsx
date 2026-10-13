import { ChevronRight, Compass, Landmark as LandmarkIcon, MapPin, MapPinPlus, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Layers } from '@/components/MapView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { corridorColor, type Corridor, type LatLng, type Pin, type Rect, type Region } from '@/lib/region'
import { cn } from '@/lib/utils'

interface Props {
  region: Region
  dark: boolean
  layers: Layers
  setLayers: (l: Layers) => void
  pins: Pin[]
  pinMode: boolean
  setPinMode: (v: boolean) => void
  renamePin: (id: string, name: string) => void
  deletePin: (id: string) => void
  selectedCorridor: string | null
  selectCorridor: (id: string | null) => void
  flyTo: (at: LatLng, zoom?: number) => void
  flyToRect: (r: Rect) => void
}

const LAYER_ROWS: { key: keyof Layers; label: string; desc: string }[] = [
  { key: 'roads', label: 'Highways & arterials', desc: 'Freeways color-coded; grid zero-lines bold' },
  { key: 'sectors', label: 'Address quadrants', desc: 'NW / NE / SW / SE around the address origin' },
  { key: 'districts', label: 'Districts & towns', desc: 'Neighborhood areas and municipal limits' },
  { key: 'landmarks', label: 'Anchor landmarks', desc: 'Commercial hubs, venues, campuses' },
  { key: 'pins', label: 'My pins', desc: 'Your personal anchors' },
  { key: 'labels', label: 'Basemap labels', desc: 'Turn off to self-test while exploring' },
]

export function ExplorerPanel(p: Props) {
  const sel = p.selectedCorridor ? p.region.corridorById.get(p.selectedCorridor) : null
  const arterials = p.region.corridors.filter((c) => c.kind === 'arterial')
  const cityGroups = [...new Set(arterials.map((c) => c.group).filter((g): g is string => !!g))]
  const groups: [string, Corridor[]][] = [
    ['Freeways & expressways', p.region.corridors.filter((c) => c.kind === 'freeway')],
    // Multi-city regions group by city; single-grid cities group by orientation.
    ...(cityGroups.length
      ? cityGroups.map((g): [string, Corridor[]] => [g, arterials.filter((c) => c.group === g)])
      : ([
          ['East–west arterials', arterials.filter((c) => c.axis === 'ew')],
          ['North–south arterials', arterials.filter((c) => c.axis === 'ns')],
          ['Diagonals', arterials.filter((c) => !c.axis)],
        ] as [string, Corridor[]][])),
  ]
  const o = p.region.region.origin

  return (
    <div className="space-y-3">
      {sel ? (
        <CorridorCard {...p} c={sel} />
      ) : (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-transparent">
          <CardContent className="flex gap-3 p-4">
            <Compass className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="space-y-1 text-[13px] leading-snug">
              <div className="font-semibold">Start at {o.label}</div>
              <p className="text-muted-foreground">
                {p.region.region.intro ?? o.note} Hover a road to inspect it; click to study it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <PinsCard {...p} />

      <Card>
        <CardHeader><CardTitle>Map layers</CardTitle></CardHeader>
        <CardContent className="space-y-2.5">
          {LAYER_ROWS.map(({ key, label, desc }) => (
            <label key={key} className="flex cursor-pointer items-center justify-between gap-3">
              <span>
                <span className="block text-sm">{label}</span>
                <span className="block text-[11px] text-muted-foreground">{desc}</span>
              </span>
              <Switch checked={p.layers[key]} onCheckedChange={(v) => p.setLayers({ ...p.layers, [key]: v })} />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Corridor directory</CardTitle><CardDescription>Click to fly to and study a route</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {groups.filter(([, cs]) => cs.length).map(([title, cs]) => (
            <div key={title}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
              <div className="flex flex-wrap gap-1.5">
                {cs.map((c) => (
                  <button key={c.id} onClick={() => { p.selectCorridor(c.id); p.flyToRect(c.bbox) }}
                    className={cn(
                      'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all hover:-translate-y-px hover:shadow',
                      p.selectedCorridor === c.id ? 'border-primary bg-primary/15' : 'bg-card hover:bg-accent',
                    )}>
                    <span className="size-2 rounded-full" style={{ background: corridorColor(c, p.dark) }} />{c.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><LandmarkIcon className="size-4" /> Anchor landmarks</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-1">
          {p.region.landmarks.map((l) => (
            <button key={l.id} onClick={() => p.flyTo(l.at, 14)}
              className="group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span>{l.name}<span className="ml-2 text-[11px] text-muted-foreground">{p.region.describe(l.at)}</span></span>
              <ChevronRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function CorridorCard(p: Props & { c: Corridor }) {
  const { c, region } = p
  const xs = region.intersections.filter((x) => x.a === c.id || x.b === c.id)
  const ordered = c.crosses.map((id) => ({ id, x: xs.find((x) => x.a === id || x.b === id)! })).filter((o) => o.x)
  return (
    <Card className="animate-pop border-primary/40">
      <CardHeader className="flex-row items-start justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="h-3 w-6 rounded-full" style={{ background: corridorColor(c, p.dark) }} />{c.name}
          </CardTitle>
          <CardDescription>{c.kind === 'freeway' ? 'Freeway' : c.axis === 'ew' ? 'East–west arterial' : c.axis === 'ns' ? 'North–south arterial' : 'Diagonal arterial'}</CardDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => p.selectCorridor(null)} aria-label="Close"><X /></Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] leading-snug text-muted-foreground">{c.desc}</p>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Crossings in order ({ordered.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {ordered.map(({ id, x }) => {
              const o = region.corridorById.get(id)!
              return (
                <button key={x.id} onClick={() => p.flyTo(x.at, 15)}
                  className="flex cursor-pointer items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[11px] hover:border-primary/60 hover:bg-accent">
                  <span className="size-1.5 rounded-full" style={{ background: corridorColor(o, p.dark) }} />
                  {x.label ?? o.name}
                </button>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function PinsCard(p: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const commit = () => { if (editing && draft.trim()) p.renamePin(editing, draft.trim()); setEditing(null) }
  return (
    <Card className={cn(p.pinMode && 'border-primary ring-2 ring-primary/30')}>
      <CardHeader className="flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2"><MapPin className="size-4" /> My anchors</CardTitle>
          <CardDescription>{p.pinMode ? 'Click anywhere on the map to drop a pin' : 'Home, office, client sites — used in quizzes & routes'}</CardDescription>
        </div>
        <Button size="sm" variant={p.pinMode ? 'default' : 'outline'} onClick={() => p.setPinMode(!p.pinMode)}>
          <MapPinPlus /> {p.pinMode ? 'Done' : 'Add'}
        </Button>
      </CardHeader>
      {p.pins.length > 0 && (
        <CardContent className="space-y-1">
          {p.pins.map((pin) => (
            <div key={pin.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
              {editing === pin.id ? (
                <form className="flex flex-1 gap-1" onSubmit={(e) => { e.preventDefault(); commit() }}>
                  <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} className="h-7 text-sm" />
                </form>
              ) : (
                <button className="flex flex-1 cursor-pointer flex-col items-start text-left" onClick={() => p.flyTo(pin.at, 15)}>
                  <span className="text-sm">{pin.name}</span>
                  <span className="text-[11px] text-muted-foreground">{p.region.describe(pin.at)}</span>
                </button>
              )}
              <div className="flex gap-0.5 opacity-60 group-hover:opacity-100">
                {['Home', 'Office', 'Client Site'].filter((n) => n !== pin.name).slice(0, 2).map((n) => (
                  <Badge key={n} variant="outline" className="hidden cursor-pointer hover:text-foreground sm:inline-flex" onClick={() => p.renamePin(pin.id, n)}>{n}</Badge>
                ))}
                <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => { setEditing(pin.id); setDraft(pin.name) }} aria-label="Rename"><Pencil /></Button>
                <Button variant="ghost" size="icon-sm" className="size-7 hover:text-danger" onClick={() => p.deletePin(pin.id)} aria-label="Delete"><Trash2 /></Button>
              </div>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  )
}
