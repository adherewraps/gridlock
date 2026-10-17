import { BarChart3, Brain, Flame, RotateCcw, Target, Trophy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress as Bar } from '@/components/ui/progress'
import { MAX_BOX, acc, scoreColor, sectorStats, weakKeys, type Progress } from '@/lib/progress'
import { buildQuestion } from '@/lib/quiz'
import type { Anchor, LatLng, Quadrant, Rect, Region } from '@/lib/region'
import { cn, pct } from '@/lib/utils'

interface Props {
  region: Region
  anchors: Anchor[]
  progress: Progress
  mastery: number
  startWeak: () => void
  reset: () => void
  flyToRect: (r: Rect, districtId?: string) => void
  flyTo: (at: LatLng, zoom?: number) => void
}

const TYPE_LABEL = { intersection: 'Intersections', boundary: 'Boundaries', connection: 'Corridors', route: 'Commutes' } as const

export function AnalyticsPanel(p: Props) {
  const { region, progress } = p
  const stats = useMemo(() => sectorStats(region, progress.history), [region, progress.history])
  const weak = useMemo(() => weakKeys(progress, 8), [progress])
  const [confirming, setConfirming] = useState(false)
  const answered = progress.history.length
  const overall = answered ? progress.history.filter((e) => e.ok).length / answered : null

  if (!answered) {
    return (
      <Card className="border-dashed">
        <CardContent className="space-y-2 p-6 text-center">
          <BarChart3 className="mx-auto size-8 text-muted-foreground" />
          <div className="font-semibold">No data yet</div>
          <p className="text-sm text-muted-foreground">Answer a few quiz questions — your accuracy will light up the map as a green-to-red mastery heatmap.</p>
        </CardContent>
      </Card>
    )
  }

  const districts = region.districts
    .map((d) => ({ d, t: stats.districts.get(d.id) }))
    .sort((a, b) => (acc(a.t) ?? 2) - (acc(b.t) ?? 2))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Brain, label: 'Mastery', value: `${p.mastery}%` },
          { icon: Target, label: 'Accuracy', value: overall == null ? '—' : pct(overall) },
          { icon: Trophy, label: 'Best streak', value: progress.bestStreak },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label} className="p-3">
            <Icon className="mb-1 size-4 text-primary" />
            <div className="font-mono text-lg font-semibold">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          </Card>
        ))}
      </div>

      <Card className="border-danger/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Flame className="size-4 text-danger" /> Needs review</CardTitle>
          <CardDescription>Ranked by spaced-repetition urgency</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {weak.length === 0 && <div className="text-sm text-muted-foreground">Nothing missed yet. 🎯</div>}
          {weak.map((k) => {
            const q = buildQuestion(region, p.anchors, k)
            const r = progress.items[k]
            if (!q) return null
            return (
              <button key={k} onClick={() => p.flyTo(q.at, 14)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent">
                <span className="flex-1 truncate">{q.reveal.label}</span>
                <span className="font-mono text-[11px] text-danger">{r.wrong}✗</span>
                <span className="font-mono text-[11px] text-success">{r.correct}✓</span>
                <span className="flex gap-px" title={`Leitner box ${r.box}/${MAX_BOX}`}>
                  {Array.from({ length: MAX_BOX }, (_, i) => <span key={i} className={cn('h-2.5 w-1 rounded-sm', i < r.box ? 'bg-success' : 'bg-muted')} />)}
                </span>
              </button>
            )
          })}
          <Button className="mt-2 w-full" variant="danger" disabled={!weak.length} onClick={p.startWeak}>
            <Target /> Target my weak spots (10 questions)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Accuracy by sector</CardTitle><CardDescription>Click a district to see it on the map</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {region.region.origin && <div className="grid grid-cols-2 gap-1.5">
            {(['NW', 'NE', 'SW', 'SE'] as Quadrant[]).map((q) => {
              const a = acc(stats.quadrants[q])
              return (
                <button key={q} onClick={() => p.flyToRect(region.quadrants[q]!)}
                  className="cursor-pointer rounded-lg border p-2 text-left transition-colors hover:bg-accent"
                  style={{ borderColor: a == null ? undefined : scoreColor(a), background: a == null ? undefined : `${scoreColor(a)}1a` }}>
                  <div className="text-xs font-semibold">{q} quadrant</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{a == null ? 'no data' : `${pct(a)} · ${stats.quadrants[q].n} answers`}</div>
                </button>
              )
            })}
          </div>}
          <div className="space-y-2">
            {districts.map(({ d, t }) => {
              const a = acc(t)
              return (
                <button key={d.id} onClick={() => p.flyToRect(d.rect, d.id)} className="block w-full cursor-pointer space-y-1 text-left">
                  <div className="flex justify-between text-xs">
                    <span>{d.name}</span>
                    <span className="font-mono text-muted-foreground">{a == null ? '—' : `${pct(a)} (${t!.n})`}</span>
                  </div>
                  <Bar value={a == null ? 0 : a * 100} indicatorStyle={{ background: scoreColor(a) }} />
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>By challenge type</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(Object.keys(TYPE_LABEL) as (keyof typeof TYPE_LABEL)[]).map((k) => {
            const t = stats.types[k]
            const a = acc(t)
            return (
              <div key={k} className="space-y-1">
                <div className="flex justify-between text-xs"><span>{TYPE_LABEL[k]}</span><span className="font-mono text-muted-foreground">{a == null ? '—' : `${pct(a)} (${t.n})`}</span></div>
                <Bar value={a == null ? 0 : a * 100} indicatorStyle={{ background: scoreColor(a) }} />
              </div>
            )
          })}
        </CardContent>
      </Card>

      {confirming ? (
        <div className="flex gap-2">
          <Button variant="danger" className="flex-1" onClick={() => { p.reset(); setConfirming(false) }}>Erase all progress</Button>
          <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setConfirming(true)}><RotateCcw /> Reset progress</Button>
      )}
    </div>
  )
}
