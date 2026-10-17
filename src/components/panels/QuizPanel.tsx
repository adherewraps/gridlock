import { ArrowRight, Check, Crosshair, Flame, Keyboard, ListChecks, RotateCcw, Shapes, Shuffle, Target, Waypoints, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress as Bar } from '@/components/ui/progress'
import { SESSION_LENGTH, type QuizSession } from '@/hooks/useQuizSession'
import type { QuizMode } from '@/lib/quiz'
import type { Region } from '@/lib/region'
import { cn } from '@/lib/utils'

interface Props {
  region: Region
  session: QuizSession | null
  streak: number
  bestStreak: number
  weakCount: number
  textMode: boolean
  setTextMode: (v: boolean) => void
  start: (mode: QuizMode | 'weak') => void
  answer: (a: { optionId: string } | { text: string }) => void
  next: () => void
  quit: () => void
}

const MODES: { mode: QuizMode; icon: typeof Crosshair; title: string; desc: string }[] = [
  { mode: 'intersection', icon: Crosshair, title: 'Intersection ID', desc: 'Name the unlabeled junction under the marker.' },
  { mode: 'boundary', icon: Shapes, title: 'Boundary Match', desc: 'Identify outlined districts, quadrants and their edge roads.' },
  { mode: 'connection', icon: Waypoints, title: 'Corridor Connection', desc: 'Which primary road links Point A to Point B?' },
  { mode: 'mixed', icon: Shuffle, title: 'Mixed Drill', desc: 'All three, weighted toward what you know least.' },
]

export function QuizPanel(p: Props) {
  const s = p.session
  if (!s) return <ModePicker {...p} />
  if (s.done) return <Summary {...p} session={s} />
  // Keyed per question so local input state resets naturally.
  return <Active key={s.question?.key} {...p} session={s} />
}

function ModePicker(p: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {MODES.map(({ mode, icon: Icon, title, desc }) => (
          <button key={mode} onClick={() => p.start(mode)}
            className="group flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10">
            <span className="grid size-8 place-items-center rounded-lg bg-primary/12 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="size-4" />
            </span>
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">{desc}</span>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-2">
            <Keyboard className="size-4 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium">Type answers</div>
              <div className="text-[11px] text-muted-foreground">Intersections only — harder, stronger recall</div>
            </div>
          </div>
          <Button size="sm" variant={p.textMode ? 'default' : 'outline'} onClick={() => p.setTextMode(!p.textMode)}>
            {p.textMode ? 'On' : 'Off'}
          </Button>
        </CardContent>
      </Card>

      <Button className="w-full" variant="outline" disabled={!p.weakCount} onClick={() => p.start('weak')}>
        <Target /> Target my weak spots {p.weakCount > 0 && <Badge variant="danger">{p.weakCount}</Badge>}
      </Button>

      <div className="flex items-center justify-center gap-4 pt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Flame className="size-3.5 text-amber-500" /> Streak {p.streak}</span>
        <span>Best {p.bestStreak}</span>
        <span>{SESSION_LENGTH} questions / round</span>
      </div>
    </div>
  )
}

function Active(p: Props & { session: QuizSession }) {
  const s = p.session
  const q = s.question!
  const total = s.queue?.length ?? SESSION_LENGTH
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const useText = p.textMode && q.type === 'intersection'

  useEffect(() => { if (useText) inputRef.current?.focus() }, [useText])

  // 1–4 to answer, Enter / → for next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (s.answered && (e.key === 'Enter' || e.key === 'ArrowRight')) { e.preventDefault(); p.next() }
      const n = Number(e.key)
      if (!s.answered && !useText && n >= 1 && n <= q.options.length) p.answer({ optionId: q.options[n - 1].id })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.answered, q, p, useText])

  const correctLabel = q.options.find((o) => o.id === q.answerId)?.label

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant={s.mode === 'weak' ? 'danger' : 'default'}>{s.mode === 'weak' ? 'Weak spots' : q.type}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{s.index + 1}/{total}</span>
        <Bar value={((s.index + (s.answered ? 1 : 0)) / total) * 100} className="h-1.5 flex-1" />
        <span className="flex items-center gap-1 text-xs font-semibold text-amber-500"><Flame className="size-3.5" />{p.streak}</span>
      </div>

      <Card key={q.key} className={cn('animate-pop', s.answered && (s.answered.ok ? 'border-success/60' : 'border-danger/60'))}>
        <CardHeader>
          <CardTitle className="text-base leading-snug">{q.prompt}</CardTitle>
          {q.hint && <CardDescription>{q.hint}</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-2">
          {useText ? (
            <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) p.answer({ text }) }} className="flex gap-2">
              <Input ref={inputRef} value={text} disabled={!!s.answered} onChange={(e) => setText(e.target.value)}
                placeholder={`e.g. ${p.region.ixLabel((p.region.region.origin && p.region.intersectionById.get(`${p.region.region.origin.ew}|${p.region.region.origin.ns}`)) || p.region.intersections[0])}`} className="font-medium" />
              <Button type="submit" disabled={!!s.answered || !text.trim()}>Check</Button>
            </form>
          ) : (
            q.options.map((o, i) => {
              const isAns = o.id === q.answerId
              const isPicked = s.answered?.picked === o.id
              return (
                <button key={o.id} disabled={!!s.answered} onClick={() => p.answer({ optionId: o.id })}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-all',
                    !s.answered && 'hover:border-primary/60 hover:bg-accent',
                    s.answered && isAns && 'border-success bg-success/15 font-semibold',
                    s.answered && isPicked && !isAns && 'border-danger bg-danger/15 line-through decoration-danger/60',
                    s.answered && !isAns && !isPicked && 'opacity-50',
                  )}>
                  <span className="grid size-5 shrink-0 place-items-center rounded border font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                  <span className="flex-1">{o.label}</span>
                  {s.answered && isAns && <Check className="size-4 text-success" />}
                  {s.answered && isPicked && !isAns && <X className="size-4 text-danger" />}
                </button>
              )
            })
          )}
        </CardContent>
      </Card>

      {s.answered && (
        <Card className="animate-pop border-l-4" style={{ borderLeftColor: s.answered.ok ? 'var(--success)' : 'var(--danger)' }}>
          <CardContent className="space-y-2 p-4">
            <div className={cn('flex items-center gap-2 text-sm font-semibold', s.answered.ok ? 'text-success' : 'text-danger')}>
              {s.answered.ok ? <Check className="size-4" /> : <X className="size-4" />}
              {s.answered.ok ? 'Correct!' : `Answer: ${correctLabel ?? q.reveal.label}`}
            </div>
            {useText && !s.answered.ok && <div className="text-xs text-muted-foreground">You typed “{s.answered.picked}”</div>}
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Why it matters</div>
            <ul className="space-y-1.5 text-[13px] leading-snug">
              {q.explanation.map((line, i) => <li key={i} className={cn(i > 0 && 'text-muted-foreground')}>{line}</li>)}
            </ul>
            <Button className="mt-1 w-full" onClick={p.next}>Next <ArrowRight /><kbd className="ml-auto font-mono text-[10px] opacity-60">Enter</kbd></Button>
          </CardContent>
        </Card>
      )}

      <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={p.quit}>End round</Button>
    </div>
  )
}

function Summary(p: Props & { session: QuizSession }) {
  const r = p.session.results
  const ok = r.filter((x) => x.ok).length
  const pctScore = r.length ? Math.round((ok / r.length) * 100) : 0
  return (
    <div className="space-y-3">
      <Card className="animate-pop text-center">
        <CardContent className="space-y-1 p-5">
          <div className={cn('font-mono text-4xl font-bold', pctScore >= 80 ? 'text-success' : pctScore >= 50 ? 'text-amber-500' : 'text-danger')}>{pctScore}%</div>
          <div className="text-sm text-muted-foreground">{ok} of {r.length} correct</div>
          {!r.length && <div className="text-sm text-muted-foreground">No questions available for this mode yet — add pins near major roads to unlock more Corridor questions.</div>}
        </CardContent>
      </Card>
      {r.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="size-4" /> Round recap</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {r.map((x, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                {x.ok ? <Check className="size-3.5 shrink-0 text-success" /> : <X className="size-3.5 shrink-0 text-danger" />}
                <span className={cn('truncate', !x.ok && 'font-medium')}>{x.label}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={p.quit}>Change mode</Button>
        <Button onClick={() => p.start(p.session.mode)}><RotateCcw /> Again</Button>
      </div>
    </div>
  )
}
