import {
  Flame, Grid2x2, Landmark, MapPin, Moon, PanelRightClose, PanelRightOpen, Route, Search, Sun, Type, SquareDashed,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import type { Layers } from '@/components/MapView'
import type { LatLng, Pin, Rect, Region } from '@/lib/region'
import { cn } from '@/lib/utils'

export type SearchHit =
  | { kind: 'corridor'; id: string; label: string; sub: string }
  | { kind: 'point'; id: string; label: string; sub: string; at: LatLng }
  | { kind: 'district'; id: string; label: string; sub: string; rect: Rect }

interface Props {
  region: Region | null
  pins: Pin[]
  layers: Layers
  setLayers: (l: Layers) => void
  mastery: number
  streak: number
  dark: boolean
  toggleDark: () => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  onPick: (hit: SearchHit) => void
  quizLocked: boolean
}

const LAYER_BUTTONS: { key: keyof Layers; icon: typeof Route; label: string }[] = [
  { key: 'roads', icon: Route, label: 'Highways & arterials' },
  { key: 'sectors', icon: Grid2x2, label: 'Address quadrants' },
  { key: 'districts', icon: SquareDashed, label: 'Districts' },
  { key: 'landmarks', icon: Landmark, label: 'Anchor landmarks' },
  { key: 'pins', icon: MapPin, label: 'My pins' },
  { key: 'heat', icon: Flame, label: 'Mastery heatmap' },
  { key: 'labels', icon: Type, label: 'Basemap labels' },
]

export function TopBar(p: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)

  const hits = useMemo<SearchHit[]>(() => {
    const r = p.region
    const s = q.trim().toLowerCase()
    if (!r || s.length < 2) return []
    const out: SearchHit[] = []
    const parts = s.split(/\s*(?:&|\band\b|@|\/|,)\s*/).filter(Boolean)
    if (parts.length === 2) {
      // "camelback & 24th" → jump straight to the junction
      const m = (c: { name: string; aliases: string[] }, f: string) => c.name.toLowerCase().includes(f) || c.aliases.some((a) => a.includes(f))
      for (const ix of r.intersections) {
        const [A, B] = [r.corridorById.get(ix.a)!, r.corridorById.get(ix.b)!]
        if ((m(A, parts[0]) && m(B, parts[1])) || (m(A, parts[1]) && m(B, parts[0])))
          out.push({ kind: 'point', id: ix.id, label: r.ixLabel(ix), sub: `Junction · ${r.describe(ix.at)}`, at: ix.at })
      }
    }
    for (const c of r.corridors)
      if (c.name.toLowerCase().includes(s) || c.aliases.some((a) => a.includes(s)))
        out.push({ kind: 'corridor', id: c.id, label: c.name, sub: c.kind === 'freeway' ? 'Freeway' : 'Arterial' })
    for (const d of r.districts)
      if (d.name.toLowerCase().includes(s)) out.push({ kind: 'district', id: d.id, label: d.name, sub: 'District', rect: d.rect })
    for (const l of r.landmarks)
      if (l.name.toLowerCase().includes(s)) out.push({ kind: 'point', id: l.id, label: l.name, sub: `Landmark · ${r.describe(l.at)}`, at: l.at })
    for (const pin of p.pins)
      if (pin.name.toLowerCase().includes(s)) out.push({ kind: 'point', id: pin.id, label: pin.name, sub: 'My pin', at: pin.at })
    return out.slice(0, 8)
  }, [q, p.region, p.pins])

  const o = p.region?.region.origin
  const example = o && p.region ? `${p.region.corridorById.get(o.ew)?.name.split(' ')[0]} & ${p.region.corridorById.get(o.ns)?.name.split(' ')[0]}`.toLowerCase() : 'road & road'
  const pick = (h: SearchHit) => { p.onPick(h); setQ(''); setOpen(false) }
  const ring = 2 * Math.PI * 15

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex flex-wrap items-start gap-2 p-3">
      {/* Brand + search */}
      <div className="pointer-events-auto relative flex min-w-0 flex-1 basis-64 items-center gap-2 rounded-xl border bg-card/85 px-3 py-1.5 shadow-lg backdrop-blur-md sm:max-w-sm">
        <div className="hidden items-center gap-1.5 pr-2 font-semibold tracking-tight sm:flex">
          <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary"><Grid2x2 className="size-3.5" /></span>
          <span className="text-sm">GridLock</span>
        </div>
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          disabled={p.quizLocked}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(0) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
            if (e.key === 'Enter' && hits[cursor]) pick(hits[cursor])
            if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur() }
          }}
          placeholder={p.quizLocked ? 'Search disabled during quiz' : `Road, place, or "${example}"`}
          className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        {open && hits.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-xl border bg-card shadow-2xl">
            {hits.map((h, i) => (
              <button key={`${h.kind}${h.id}`} onMouseDown={() => pick(h)} onMouseEnter={() => setCursor(i)}
                className={cn('flex w-full flex-col items-start px-3 py-2 text-left', i === cursor && 'bg-accent')}>
                <span className="text-sm font-medium">{h.label}</span>
                <span className="text-[11px] text-muted-foreground">{h.sub}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Layer toggles */}
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border bg-card/85 p-1 shadow-lg backdrop-blur-md">
        {LAYER_BUTTONS.map(({ key, icon: Icon, label }) => (
          <Tip key={key} label={`${p.layers[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>
            <button
              aria-label={label}
              aria-pressed={p.layers[key]}
              onClick={() => p.setLayers({ ...p.layers, [key]: !p.layers[key] })}
              className={cn(
                'grid size-8 cursor-pointer place-items-center rounded-lg transition-colors',
                p.layers[key] ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
            </button>
          </Tip>
        ))}
      </div>

      <div className="flex-1" />

      {/* Mastery + theme + sidebar */}
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border bg-card/85 py-1 pl-1.5 pr-1 shadow-lg backdrop-blur-md">
        <Tip label="Spatial mastery: average recall strength across everything you've studied">
          <div className="flex items-center gap-2 pr-1">
            <svg viewBox="0 0 36 36" className="size-9 -rotate-90">
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--muted)" strokeWidth="4" />
              <circle cx="18" cy="18" r="15" fill="none" stroke="var(--success)" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={ring} strokeDashoffset={ring * (1 - p.mastery / 100)} className="transition-[stroke-dashoffset] duration-700" />
            </svg>
            <div className="leading-tight">
              <div className="font-mono text-sm font-semibold">{p.mastery}%</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Mastery</div>
            </div>
          </div>
        </Tip>
        {p.streak > 0 && (
          <div className="flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-semibold text-amber-500">
            <Flame className="size-3.5" />{p.streak}
          </div>
        )}
        <Tip label={p.dark ? 'Light mode' : 'Dark mode'}>
          <Button variant="ghost" size="icon-sm" onClick={p.toggleDark} aria-label="Toggle theme">
            {p.dark ? <Sun /> : <Moon />}
          </Button>
        </Tip>
        <Tip label={p.sidebarOpen ? 'Collapse panel' : 'Open panel'}>
          <Button variant="ghost" size="icon-sm" onClick={p.toggleSidebar} aria-label="Toggle sidebar">
            {p.sidebarOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </Tip>
      </div>
    </div>
  )
}
