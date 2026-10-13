import { ArrowDown, ArrowUpDown, Check, Dices, Eraser, Route as RouteIcon, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { corridorColor, fmtMi, type Anchor, type Corridor, type Region } from '@/lib/region'
import type { RouteVerdict } from '@/lib/routing'
import { cn, shuffle } from '@/lib/utils'

export interface RouteState { startId: string; endId: string; picked: string[]; verdict: RouteVerdict | null }

interface Props {
  region: Region
  dark: boolean
  anchors: Anchor[]
  state: RouteState
  setState: (s: RouteState) => void
  check: () => void
}

const mins = (s: number) => `${Math.max(1, Math.round(s / 60))} min`

export function RoutePanel({ region, dark, anchors, state, setState, check }: Props) {
  const v = state.verdict
  const name = (id: string) => region.corridorById.get(id)?.name ?? id
  const set = (patch: Partial<RouteState>) => setState({ ...state, verdict: null, ...patch })
  const toggle = (id: string) => set({ picked: state.picked.includes(id) ? state.picked.filter((x) => x !== id) : [...state.picked, id] })
  const groups: [string, Corridor[]][] = [
    ['Freeways', region.corridors.filter((c) => c.kind === 'freeway')],
    ['Arterials', region.corridors.filter((c) => c.kind === 'arterial')],
  ]
  const ready = state.startId && state.endId && state.startId !== state.endId

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><RouteIcon className="size-4" /> Commute simulator</CardTitle>
          <CardDescription>Pick two anchors, then choose the primary roads you'd drive. No turn-by-turn — just the corridors.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-cyan-400 text-xs font-bold text-slate-900">A</span>
            <NativeSelect value={state.startId} onChange={(e) => set({ startId: e.target.value })}>
              <option value="">Start anchor…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.custom ? '📍 ' : ''}{a.name}</option>)}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-2 pl-0.5">
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Swap" onClick={() => set({ startId: state.endId, endId: state.startId })}><ArrowUpDown /></Button>
            <div className="h-px flex-1 bg-border" />
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => {
              const [a, b] = shuffle(anchors)
              if (a && b) set({ startId: a.id, endId: b.id, picked: [] })
            }}><Dices /> Random commute</Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-400 text-xs font-bold text-slate-900">B</span>
            <NativeSelect value={state.endId} onChange={(e) => set({ endId: e.target.value })}>
              <option value="">End anchor…</option>
              {anchors.map((a) => <option key={a.id} value={a.id}>{a.custom ? '📍 ' : ''}{a.name}</option>)}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <Card className={cn(!ready && 'pointer-events-none opacity-50')}>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle>Your corridors</CardTitle>
            <CardDescription>{state.picked.length ? state.picked.map(name).join(' → ') : 'Tap the roads you would use'}</CardDescription>
          </div>
          {state.picked.length > 0 && <Button variant="ghost" size="icon-sm" onClick={() => set({ picked: [] })} aria-label="Clear"><Eraser /></Button>}
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.map(([title, cs]) => (
            <div key={title}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
              <div className="flex flex-wrap gap-1.5">
                {cs.map((c) => {
                  const on = state.picked.includes(c.id)
                  const verdictTint = v && on ? (v.optimal.corridors.includes(c.id) || (v.ok && !v.unused.includes(c.id)) ? 'border-success bg-success/15' : 'border-danger bg-danger/10') : ''
                  return (
                    <button key={c.id} onClick={() => toggle(c.id)}
                      className={cn('flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all',
                        on ? 'border-primary bg-primary/15 font-medium' : 'bg-card hover:bg-accent', verdictTint)}>
                      <span className="size-2 rounded-full" style={{ background: corridorColor(c, dark) }} />{c.name}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <Button className="w-full" disabled={!ready || !state.picked.length} onClick={check}>Check my route</Button>
        </CardContent>
      </Card>

      {v && (
        <Card className="animate-pop border-l-4" style={{ borderLeftColor: v.ok ? 'var(--success)' : 'var(--danger)' }}>
          <CardContent className="space-y-3 p-4">
            <div className={cn('flex items-center gap-2 text-sm font-semibold', v.ok ? 'text-success' : 'text-danger')}>
              {v.ok ? <Check className="size-4" /> : <X className="size-4" />}
              {v.ok
                ? v.slowdown! <= 1.01 ? 'Optimal route!' : `Solid route — within ${Math.round((v.slowdown! - 1) * 100)}% of the fastest`
                : !v.mine ? "Those corridors don't connect A to B" : `Works, but ${Math.round((v.slowdown! - 1) * 100)}% slower than the best plan`}
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Fastest corridor plan · ~{mins(v.optimal.seconds)} · {fmtMi(v.optimal.meters)}
              </div>
              <ol className="space-y-0.5">
                {v.optimal.legs.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    {l.corridor ? (
                      <>
                        <span className="h-2 w-4 shrink-0 rounded-full" style={{ background: corridorColor(region.corridorById.get(l.corridor)!, dark) }} />
                        <span className="font-medium">{name(l.corridor)}</span>
                        <span className="ml-auto font-mono text-[11px] text-muted-foreground">{fmtMi(l.m)}</span>
                      </>
                    ) : (
                      <span className="flex items-center gap-2 text-muted-foreground"><ArrowDown className="size-3" /> local streets</span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-wrap gap-1">
              {v.hits.map((c) => <Badge key={c} variant="success">✓ {name(c)}</Badge>)}
              {!v.ok && v.missed.map((c) => <Badge key={c} variant="danger">missed {name(c)}</Badge>)}
              {v.unused.map((c) => <Badge key={c} variant="outline">unused {name(c)}</Badge>)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
