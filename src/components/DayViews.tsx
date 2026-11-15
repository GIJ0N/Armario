import { Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { useAi } from '../ai/AiProviderContext'
import { providerOf, suggestForDate } from '../calendar/suggest'
import { capitalize, longDayLabel } from '../calendar/grid'
import { OCCASIONS, OCCASION_LABELS, type Garment, type Occasion, type Outfit, type OutfitInput, type SavedOutfit } from '../db'
import type { SuggestedOutfit } from '../engine'
import { NEUTRAL_WEATHER_NOTE, weatherForDate, type DailyForecastResult } from '../weather'
import { BottomSheet } from './BottomSheet'
import { OutfitVisual } from './OutfitVisual'
import { useRepository } from './RepositoryContext'
import { SkeletonBlock } from './Skeleton'

const nameOfOutfit = (o: Outfit) => o.name || `Outfit de ${OCCASION_LABELS[o.occasion].toLowerCase()}`

/** «Elegir de mis guardados»: outfits guardados con su lienzo pequeño; elegir uno lo registra en el día. */
export function SavedPicker({
  date,
  garments,
  saved,
  verb,
  onPick,
  onBack,
}: {
  date: string
  garments: Map<string, Garment>
  saved: SavedOutfit[] | null
  /** «usado» o «planeado»: cómo quedará registrado. */
  verb: string
  onPick: (outfit: Outfit) => Promise<void>
  onBack: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function pick(o: Outfit) {
    setBusy(o.id)
    setError(null)
    try {
      await onPick(o)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
      setBusy(null)
    }
  }
  return (
    <BottomSheet title="Mis outfits guardados" onClose={onBack}>
      <p className="page-hint sheet-lead">
        Elige uno: quedará {verb} el {longDayLabel(date)}.
      </p>
      {!saved && <SkeletonBlock height={180} />}
      {saved && saved.length === 0 && (
        <p className="page-hint">Aún no tienes outfits guardados. Crea uno o pide una sugerencia.</p>
      )}
      {saved && saved.length > 0 && (
        <ul className="saved-list" aria-label="Outfits guardados">
          {saved.map((s) => {
            const items = s.outfit.garment_ids.map((id) => garments.get(id)).filter((g): g is Garment => !!g)
            return (
              <li key={s.outfit.id} className="saved-card" data-testid="pick-saved">
                <div className="saved-canvas">
                  <OutfitVisual items={items} size="small" layout={s.outfit.canvas_layout} />
                </div>
                <div className="saved-info">
                  <strong className="saved-name">{nameOfOutfit(s.outfit)}</strong>
                  <span className="muted">{OCCASION_LABELS[s.outfit.occasion]}</span>
                  <div className="saved-actions">
                    <button type="button" className="btn btn-primary btn-inline" disabled={busy !== null} onClick={() => void pick(s.outfit)}>
                      Elegir
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" onClick={onBack}>
          Volver
        </button>
      </div>
    </BottomSheet>
  )
}

type Shown = SuggestedOutfit & { key: string }

/** «Sugerir»: corre el motor para la fecha (con su pronóstico si lo hay) y deja elegir uno de los 3. */
export function SuggestView({
  date,
  defaultOccasion,
  forecast,
  verb,
  onPick,
  onBack,
}: {
  date: string
  defaultOccasion: Occasion
  forecast: DailyForecastResult | null
  verb: string
  /** Guarda el outfit elegido (crea su fila) y lo registra en el día. */
  onPick: (input: OutfitInput) => Promise<void>
  onBack: () => void
}) {
  const repo = useRepository()
  const ai = useAi()
  const [occasion, setOccasion] = useState<Occasion>(defaultOccasion)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outfits, setOutfits] = useState<Shown[] | null>(null)
  const [pool, setPool] = useState<Map<string, Garment>>(new Map())
  const [warnings, setWarnings] = useState<string[]>([])
  const shown = useRef<string[][]>([])
  const runId = useRef(0)
  const dw = weatherForDate(forecast, date)

  async function run(more: boolean) {
    const id = ++runId.current
    setBusy(true)
    setError(null)
    if (!more) shown.current = []
    try {
      const res = await suggestForDate({
        repo,
        provider: providerOf(ai),
        date,
        occasion,
        weather: dw.weather,
        shown: shown.current,
      })
      if (id !== runId.current) return
      shown.current.push(...res.outfits.map((o) => o.garmentIds))
      setPool(new Map(res.pool.map((g) => [g.id, g])))
      setWarnings(res.warnings)
      setOutfits(res.outfits.map((o) => ({ ...o, key: o.garmentIds.join('|') })))
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : 'No se pudieron generar los outfits.')
    } finally {
      if (id === runId.current) setBusy(false)
    }
  }

  async function pick(o: Shown) {
    setPicking(true)
    setError(null)
    try {
      await onPick({
        garment_ids: o.garmentIds,
        occasion,
        weather_snapshot: dw.weather,
        reasoning: o.reasoning,
        source: o.source === 'ia' ? 'ai' : 'rules',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
      setPicking(false)
    }
  }

  return (
    <BottomSheet title="Sugerir outfits" onClose={onBack}>
      <p className="page-hint sheet-lead">
        Para el {longDayLabel(date)}; el elegido quedará {verb}.
      </p>
      <div className="chips chips-scroll" role="group" aria-label="Ocasión">
        {OCCASIONS.map((o) => (
          <button
            key={o}
            type="button"
            className={`chip${o === occasion ? ' chip-active' : ''}`}
            aria-pressed={o === occasion}
            onClick={() => {
              runId.current++
              setOccasion(o)
              setOutfits(null)
              setBusy(false)
            }}
          >
            {OCCASION_LABELS[o]}
          </button>
        ))}
      </div>
      <p className="cal-weather" data-testid="suggest-weather">
        {dw.source === 'forecast'
          ? `Pronóstico: ${Math.round(dw.day.tempMinC)}° a ${Math.round(dw.day.tempMaxC)}° · lluvia ${Math.round(dw.day.precipProbability)}%`
          : capitalize(NEUTRAL_WEATHER_NOTE)}
      </p>
      <button type="button" className="btn btn-primary btn-block" disabled={busy || picking} onClick={() => void run(false)}>
        <Sparkles size={18} aria-hidden="true" />
        {busy && !outfits ? 'Armando outfits…' : 'Sugerir'}
      </button>
      {warnings.map((w) => (
        <p key={w} className="warning" role="status">
          {w}
        </p>
      ))}
      {outfits && (
        <ul className="saved-list" aria-label="Outfits sugeridos">
          {outfits.map((o) => {
            const items = o.garmentIds.map((id) => pool.get(id)).filter((g): g is Garment => !!g)
            return (
              <li key={o.key} className="saved-card" data-testid="suggested-outfit">
                <div className="saved-canvas">
                  <OutfitVisual items={items} size="small" />
                </div>
                <div className="saved-info">
                  <span className="badge badge-source">{o.source === 'ia' ? 'IA' : 'reglas'}</span>
                  <span className="muted">{o.reasoning}</span>
                  <div className="saved-actions">
                    <button type="button" className="btn btn-primary btn-inline" disabled={picking || busy} onClick={() => void pick(o)}>
                      Elegir este
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {outfits && outfits.length > 0 && (
        <button type="button" className="btn btn-block" disabled={busy || picking} onClick={() => void run(true)}>
          {busy ? 'Buscando…' : 'Otras opciones'}
        </button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" onClick={onBack}>
          Volver
        </button>
      </div>
    </BottomSheet>
  )
}
