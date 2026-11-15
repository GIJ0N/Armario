import { RefreshCw, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAi } from '../ai/AiProviderContext'
import { capitalize, longDayLabel } from '../calendar/grid'
import { defaultOccasionFor, defaultPlanDays, mostUsedWeekdayOccasion } from '../calendar/planWeek'
import { providerOf, suggestForDate, WEARS_LOOKBACK_DAYS } from '../calendar/suggest'
import { OCCASIONS, OCCASION_LABELS, type Garment, type Occasion } from '../db'
import type { WearRecord, Weather } from '../engine'
import { addDays } from '../lib/date'
import { NEUTRAL_WEATHER_NOTE, weatherForDate, type DailyForecastResult } from '../weather'
import { BottomSheet } from './BottomSheet'
import { OutfitEditFlow } from './OutfitEditFlow'
import { OutfitVisual } from './OutfitVisual'
import { useRepository } from './RepositoryContext'
import { useToast } from './ToastProvider'

/** Días que se ofrecen en el selector (a partir de mañana). */
const OFFERED_DAYS = 14

interface Draft {
  date: string
  occasion: Occasion
  garmentIds: string[]
  reasoning: string
  source: 'ai' | 'rules' | 'manual'
  weather: Weather
  /** true si no se pudo armar un outfit para este día. */
  failed: boolean
}

type Step = 'choose' | 'generating' | 'review' | 'saving'

interface Props {
  today: string
  forecast: DailyForecastResult | null
  /** Se llama tras guardar el plan, con la recarga del calendario ya hecha. */
  onSaved: () => Promise<void>
  onClose: () => void
}

/**
 * «Planear semana»: elige días y ocasiones, genera un outfit por día de forma secuencial con el motor (reglas o IA con su
 * respaldo de reglas), deja revisar y cambiar cada uno y solo escribe los planes al pulsar «Guardar plan».
 */
export function PlanWeekSheet({ today, forecast, onSaved, onClose }: Props) {
  const repo = useRepository()
  const ai = useAi()
  const toast = useToast()
  const [step, setStep] = useState<Step>('choose')
  const [ready, setReady] = useState(false)
  const [pool, setPool] = useState<Garment[]>([])
  const [rotation, setRotation] = useState<WearRecord[]>([])
  const [weekdayOccasion, setWeekdayOccasion] = useState<Occasion>('plant_work')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [occasions, setOccasions] = useState<Record<string, Occasion>>({})
  const [planned, setPlanned] = useState<Set<string>>(new Set())
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [swapping, setSwapping] = useState<{ date: string; garmentId: string } | null>(null)
  const [busyDay, setBusyDay] = useState<string | null>(null)
  const runId = useRef(0)

  const days = useMemo(() => Array.from({ length: OFFERED_DAYS }, (_, i) => addDays(today, i + 1)), [today])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      repo.plans.listBetween(days[0], days[days.length - 1]),
      repo.wears.listHistory(200),
      repo.list({ statuses: ['active', 'laundry'] }),
      repo.wears.listSince(WEARS_LOOKBACK_DAYS),
    ]).then(([plans, history, all, recent]) => {
      if (cancelled) return
      const withPlan = new Set(plans.map((p) => p.date))
      const common = mostUsedWeekdayOccasion(history.map((h) => ({ date: h.date, occasion: h.occasion })))
      const chosen = new Set(defaultPlanDays(today, withPlan))
      setPlanned(withPlan)
      setWeekdayOccasion(common)
      setSelected(Object.fromEntries(days.map((d) => [d, chosen.has(d)])))
      setOccasions(Object.fromEntries(days.map((d) => [d, defaultOccasionFor(d, common)])))
      setPool(all)
      setRotation(recent.map((w) => ({ garmentIds: w.garmentIds, date: w.date })))
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [repo, days, today])

  const byId = useMemo(() => new Map(pool.map((g) => [g.id, g])), [pool])
  const chosenDays = days.filter((d) => selected[d])

  /** Un outfit para `date`, sin repetir lo ya armado para los demás días. */
  const generate = useCallback(
    async (date: string, occasion: Occasion, others: Draft[], extraShown: string[][] = []): Promise<Draft> => {
      const dw = weatherForDate(forecast, date)
      const res = await suggestForDate({
        repo,
        provider: providerOf(ai),
        date,
        occasion,
        weather: dw.weather,
        drafts: others.filter((d) => !d.failed).map((d) => ({ garmentIds: d.garmentIds, date: d.date })),
        shown: extraShown,
      })
      const best = res.outfits[0]
      if (!best) return { date, occasion, garmentIds: [], reasoning: res.warnings[0] ?? 'No se pudo armar un outfit.', source: 'rules', weather: dw.weather, failed: true }
      return {
        date,
        occasion,
        garmentIds: best.garmentIds,
        reasoning: best.reasoning,
        source: best.source === 'ia' ? 'ai' : 'rules',
        weather: dw.weather,
        failed: false,
      }
    },
    [repo, ai, forecast],
  )

  async function start() {
    const id = ++runId.current
    setStep('generating')
    setError(null)
    const made: Draft[] = []
    try {
      // Secuencial: cada día ve lo que ya se armó para evitar repetir prendas y combinaciones.
      for (let i = 0; i < chosenDays.length; i++) {
        setProgress({ done: i, total: chosenDays.length })
        const d = await generate(chosenDays[i], occasions[chosenDays[i]], made)
        if (id !== runId.current) return
        made.push(d)
      }
      setDrafts(made)
      setProgress(null)
      setStep('review')
    } catch (e) {
      if (id !== runId.current) return
      setError(e instanceof Error ? e.message : 'No se pudo armar el plan.')
      setStep('choose')
      setProgress(null)
    }
  }

  async function regenerate(date: string) {
    const cur = drafts.find((d) => d.date === date)
    if (!cur) return
    setBusyDay(date)
    setError(null)
    try {
      const next = await generate(date, cur.occasion, drafts.filter((d) => d.date !== date), cur.failed ? [] : [cur.garmentIds])
      setDrafts((all) => all.map((d) => (d.date === date ? next : d)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar otro outfit.')
    } finally {
      setBusyDay(null)
    }
  }

  async function save() {
    setStep('saving')
    setError(null)
    const rest = [...drafts]
    let saved = 0
    try {
      for (const d of drafts) {
        if (d.failed) {
          rest.splice(rest.indexOf(d), 1)
          continue
        }
        const outfit = await repo.outfits.create({
          garment_ids: d.garmentIds,
          occasion: d.occasion,
          weather_snapshot: d.weather,
          reasoning: d.reasoning,
          source: d.source,
        })
        await repo.plans.create(outfit.id, d.date, d.occasion)
        rest.splice(rest.indexOf(d), 1)
        saved++
      }
      await onSaved()
      toast(saved === 1 ? 'Plan guardado: 1 día' : `Plan guardado: ${saved} días`)
      onClose()
    } catch (e) {
      // Lo ya escrito queda; se quitan de la lista para no duplicarlo al reintentar.
      setDrafts(rest)
      setError(e instanceof Error ? e.message : 'No se pudo guardar el plan.')
      setStep('review')
      if (saved > 0) await onSaved().catch(() => undefined)
    }
  }

  if (swapping) {
    const draft = drafts.find((d) => d.date === swapping.date)
    const items = (draft?.garmentIds ?? []).map((id) => byId.get(id)).filter((g): g is Garment => !!g)
    if (!draft) return null
    return (
      <OutfitEditFlow
        ctx={{ occasion: draft.occasion, weather: draft.weather, garments: pool, wears: rotation, today: draft.date }}
        items={items}
        target={{ kind: 'swap', garmentId: swapping.garmentId }}
        onApply={(next, summary) => {
          setDrafts((all) => all.map((d) => (d.date === draft.date ? { ...d, garmentIds: next.map((g) => g.id), source: 'manual', reasoning: 'Editado a mano.' } : d)))
          setSwapping(null)
          toast(summary)
        }}
        onClose={() => setSwapping(null)}
      />
    )
  }

  if (step === 'choose') {
    return (
      <BottomSheet title="Planear semana" onClose={onClose}>
        <p className="page-hint sheet-lead">Elige los días y la ocasión de cada uno. Nada se guarda hasta que revises el plan.</p>
        {!ready ? (
          <p className="page-hint">Cargando…</p>
        ) : (
          <ul className="plan-days" aria-label="Días a planear">
            {days.map((d) => (
              <li key={d} className="plan-day">
                <label className="check plan-check">
                  <input
                    type="checkbox"
                    checked={!!selected[d]}
                    onChange={(e) => setSelected((cur) => ({ ...cur, [d]: e.target.checked }))}
                  />
                  <span>
                    {capitalize(longDayLabel(d))}
                    {planned.has(d) && <small className="muted"> · ya tiene plan</small>}
                  </span>
                </label>
                {selected[d] && (
                  <select
                    className="plan-occasion"
                    aria-label={`Ocasión del ${longDayLabel(d)}`}
                    value={occasions[d]}
                    onChange={(e) => setOccasions((cur) => ({ ...cur, [d]: e.target.value as Occasion }))}
                  >
                    {OCCASIONS.map((o) => (
                      <option key={o} value={o}>
                        {OCCASION_LABELS[o]}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <p className="page-hint plan-note">
          Entre semana: {OCCASION_LABELS[weekdayOccasion].toLowerCase()} (lo que más usas); fin de semana: casual. Los días sin pronóstico usan clima templado.
        </p>
        <div className="sheet-actions sheet-gap">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || chosenDays.length === 0} onClick={() => void start()}>
            <Sparkles size={18} aria-hidden="true" />
            Armar {chosenDays.length === 1 ? '1 outfit' : `${chosenDays.length} outfits`}
          </button>
        </div>
      </BottomSheet>
    )
  }

  if (step === 'generating') {
    return (
      <BottomSheet title="Planear semana" onClose={() => { runId.current++; onClose() }}>
        <p className="page-hint" role="status" data-testid="plan-progress">
          Armando outfit {Math.min((progress?.done ?? 0) + 1, progress?.total ?? 1)} de {progress?.total ?? chosenDays.length}…
        </p>
        <div className="sheet-actions sheet-gap">
          <button
            type="button"
            className="btn"
            onClick={() => {
              runId.current++
              onClose()
            }}
          >
            Cancelar
          </button>
        </div>
      </BottomSheet>
    )
  }

  const saving = step === 'saving'
  return (
    <BottomSheet title="Revisa el plan" onClose={saving ? () => undefined : onClose}>
      <p className="page-hint sheet-lead">Toca una prenda para cambiarla o pide otra opción para ese día.</p>
      {drafts.length === 0 && <p className="page-hint">No quedan días en el plan.</p>}
      <ul className="saved-list" aria-label="Plan de la semana">
        {drafts.map((d) => {
          const items = d.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => !!g)
          const dw = weatherForDate(forecast, d.date)
          return (
            <li key={d.date} className="saved-card day-entry" data-testid="plan-draft" data-date={d.date}>
              <div className="saved-canvas">
                {d.failed ? (
                  <p className="page-hint">Sin outfit</p>
                ) : (
                  <OutfitVisual items={items} size="small" onSelectGarment={(id) => setSwapping({ date: d.date, garmentId: id })} />
                )}
              </div>
              <div className="saved-info">
                <strong className="saved-name">{capitalize(longDayLabel(d.date))}</strong>
                <span className="muted">
                  {OCCASION_LABELS[d.occasion]} ·{' '}
                  {dw.source === 'forecast' ? `${Math.round(dw.day.tempMaxC)}°` : NEUTRAL_WEATHER_NOTE}
                </span>
                <span className="muted draft-reasoning">{d.reasoning}</span>
                <div className="saved-actions">
                  <button type="button" className="btn btn-inline" disabled={saving || busyDay !== null} onClick={() => void regenerate(d.date)}>
                    <RefreshCw size={16} aria-hidden="true" />
                    {busyDay === d.date ? 'Buscando…' : d.failed ? 'Reintentar' : 'Otra opción'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-inline"
                    disabled={saving}
                    aria-label={`Quitar ${longDayLabel(d.date)} del plan`}
                    onClick={() => setDrafts((all) => all.filter((x) => x.date !== d.date))}
                  >
                    <X size={16} aria-hidden="true" />
                    Quitar día
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" disabled={saving} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={saving || drafts.every((d) => d.failed)} onClick={() => void save()}>
          {saving ? 'Guardando…' : 'Guardar plan'}
        </button>
      </div>
    </BottomSheet>
  )
}
