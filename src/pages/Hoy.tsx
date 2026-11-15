import { useEffect, useRef, useState } from 'react'
import { useAi } from '../ai/AiProviderContext'
import type { AiProvider } from '../ai/provider'
import { OutfitCard } from '../components/OutfitCard'
import { useRepository } from '../components/RepositoryContext'
import { OCCASIONS, OCCASION_LABELS, type FeedbackEntry, type Garment, type Occasion, type Rating } from '../db'
import { daysBetween, NO_REPEAT_DAYS, suggestOutfits, type SuggestedOutfit, type Weather } from '../engine'
import { localDateString } from '../lib/date'
import { useSettings } from '../settings'
import { loadTaste, maybeUpdateTasteProfile } from '../taste'
import {
  loadWeather,
  WEATHER_PRESETS,
  WEATHER_PRESET_KEYS,
  WEATHER_PRESET_LABELS,
  type WeatherPresetKey,
  type WeatherResult,
} from '../weather'

type WeatherState = { status: 'loading' } | { status: 'ready'; result: WeatherResult | null }

/** Sugerencia mostrada; `outfitId` es la fila guardada (null si no se pudo guardar). */
type ShownOutfit = SuggestedOutfit & { outfitId: string | null }

interface Suggestions {
  outfits: ShownOutfit[]
  garments: Map<string, Garment>
  warnings: string[]
}

/** Historial de usos que alimenta la rotación (días). */
const WEARS_LOOKBACK_DAYS = 60

const deg = (n: number) => `${Math.round(n)}°`

function ageLabel(ms: number): string {
  const h = Math.max(1, Math.round(ms / 3_600_000))
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`
}

export default function HoyPage() {
  const repo = useRepository()
  const ai = useAi()
  const [settings] = useSettings()
  const [occasion, setOccasion] = useState<Occasion>('casual')
  const [weatherState, setWeatherState] = useState<WeatherState>({ status: 'loading' })
  const [manual, setManual] = useState<WeatherPresetKey | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null)
  const [worn, setWorn] = useState<Set<string>>(new Set())
  const [wearBusy, setWearBusy] = useState(false)
  const [ratings, setRatings] = useState<Map<string, FeedbackEntry>>(new Map())
  const runId = useRef(0)
  /** Outfits ya mostrados en esta sesión (solo en memoria): «Otras opciones» no los repite. */
  const shown = useRef<string[][]>([])

  useEffect(() => {
    let cancelled = false
    void loadWeather().then((result) => !cancelled && setWeatherState({ status: 'ready', result }))
    return () => {
      cancelled = true
    }
  }, [settings.city])

  const loaded = weatherState.status === 'ready' ? weatherState.result : null
  const weather: Weather | null = manual ? WEATHER_PRESETS[manual] : (loaded?.weather ?? null)
  const showPresets = picking || (weatherState.status === 'ready' && !loaded && !manual)

  function pickOccasion(o: Occasion) {
    runId.current++
    shown.current = []
    setOccasion(o)
    setSuggestions(null)
    setError(null)
  }

  async function run(excludeShown: boolean) {
    if (!weather) return
    const id = ++runId.current
    setBusy(true)
    setError(null)
    try {
      const garments = await repo.list({ statuses: ['active'] })
      const today = localDateString()
      // Rotación y no repetir usan lo USADO de verdad; lo solo sugerido no cuenta.
      const wearEntries = await repo.wears.listSince(WEARS_LOOKBACK_DAYS)
      const wears = wearEntries.map((w) => ({ garmentIds: w.garmentIds, date: w.date }))
      const recentOutfits = wears.filter((w) => daysBetween(w.date, today) <= NO_REPEAT_DAYS)
      if (!excludeShown) shown.current = []
      for (const ids of shown.current) recentOutfits.push({ garmentIds: ids, date: today })
      let provider: AiProvider | undefined
      if (ai.configured) {
        try {
          provider = ai.getProvider()
        } catch {
          provider = undefined
        }
      }
      // El gusto nunca debe impedir sugerir: si falla, se sugiere sin él.
      const taste = await loadTaste(repo, garments).catch(() => null)
      const res = await suggestOutfits(
        {
          occasion,
          weather,
          garments,
          wears,
          recentOutfits,
          today,
          ...(taste
            ? { taste: taste.preferences, tasteSummary: taste.summary, likedOutfits: taste.likedOutfits }
            : {}),
        },
        provider,
      )
      const warnings = [...res.warnings]
      const outfits: ShownOutfit[] = res.outfits.map((o) => ({ ...o, outfitId: null }))
      try {
        for (const o of outfits) {
          const saved = await repo.outfits.create({
            garment_ids: o.garmentIds,
            occasion,
            weather_snapshot: weather,
            reasoning: o.reasoning,
            source: o.source === 'ia' ? 'ai' : 'rules',
          })
          o.outfitId = saved.id
        }
      } catch {
        warnings.push('No se pudieron guardar las sugerencias en el historial.')
      }
      if (id !== runId.current) return
      shown.current.push(...outfits.map((o) => o.garmentIds))
      setSuggestions({ outfits, garments: new Map(garments.map((g) => [g.id, g])), warnings })
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : 'No se pudieron generar los outfits.')
    } finally {
      if (id === runId.current) setBusy(false)
    }
  }

  async function toggleWear(o: ShownOutfit, on: boolean) {
    if (!o.outfitId) return
    setWearBusy(true)
    setError(null)
    try {
      const today = localDateString()
      if (on) await repo.wears.create(o.outfitId, today)
      else await repo.wears.deleteForOutfitOnDate(o.outfitId, today)
      setWorn((prev) => {
        const next = new Set(prev)
        if (on) next.add(o.outfitId!)
        else next.delete(o.outfitId!)
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el uso.')
    } finally {
      setWearBusy(false)
    }
  }

  async function rate(o: ShownOutfit, rating: Rating, tags: string[], comment: string) {
    if (!o.outfitId) throw new Error('Outfit sin guardar')
    const entry = await repo.feedback.rate(o.outfitId, rating, tags, comment)
    setRatings((prev) => new Map(prev).set(o.outfitId!, entry))
    // Perfil de gusto en segundo plano: no bloquea la interfaz ni muestra errores.
    let provider: AiProvider | undefined
    if (ai.configured) {
      try {
        provider = ai.getProvider()
      } catch {
        provider = undefined
      }
    }
    void maybeUpdateTasteProfile(repo, provider)
  }

  return (
    <section>
      <h1 className="page-title">Hoy</h1>

      <div className="chips" role="group" aria-label="Ocasión">
        {OCCASIONS.map((o) => (
          <button
            key={o}
            type="button"
            className={`chip${o === occasion ? ' chip-active' : ''}`}
            aria-pressed={o === occasion}
            onClick={() => pickOccasion(o)}
          >
            {OCCASION_LABELS[o]}
          </button>
        ))}
      </div>

      <div className="weather-card" data-testid="weather-card">
        {weatherState.status === 'loading' && !manual && <p className="page-hint">Consultando el clima…</p>}
        {weather && (
          <>
            <div className="weather-main">
              <strong className="weather-temp">{deg(weather.tempC)}</strong>
              <span>
                Mín {deg(weather.tempMinC)} · Máx {deg(weather.tempMaxC)}
              </span>
              <span>
                Lluvia {Math.round(weather.precipProbability)}%{weather.isRaining ? ' (llueve ahora)' : ''}
              </span>
            </div>
            <p className="muted weather-note">
              {manual
                ? `Clima manual: ${WEATHER_PRESET_LABELS[manual]}`
                : loaded?.origin === 'antiguo'
                  ? `Sin conexión: clima guardado ${ageLabel(loaded.ageMs)} en ${loaded.city}`
                  : loaded?.origin === 'cache'
                    ? `Clima de ${loaded.city} (guardado)`
                    : `Clima de ${loaded?.city ?? ''}`}
            </p>
          </>
        )}
        {weatherState.status === 'ready' && !weather && (
          <p className="page-hint">No se pudo obtener el clima. Elige uno:</p>
        )}
        {showPresets ? (
          <div className="chips" role="group" aria-label="Clima manual">
            {WEATHER_PRESET_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className={`chip${manual === k ? ' chip-active' : ''}`}
                aria-pressed={manual === k}
                onClick={() => {
                  setManual(k)
                  setPicking(false)
                  shown.current = []
                  setSuggestions(null)
                }}
              >
                {WEATHER_PRESET_LABELS[k]}
              </button>
            ))}
          </div>
        ) : (
          weatherState.status === 'ready' && (
            <button type="button" className="btn btn-quiet btn-inline" onClick={() => setPicking(true)}>
              Cambiar clima
            </button>
          )
        )}
        {manual && !showPresets && (
          <button
            type="button"
            className="btn btn-quiet btn-inline"
            onClick={() => {
              setManual(null)
              shown.current = []
              setSuggestions(null)
            }}
          >
            Usar clima real
          </button>
        )}
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy || !weather}
        onClick={() => void run(false)}
      >
        {busy && !suggestions ? 'Armando outfits…' : 'Sugerir outfits'}
      </button>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}

      {suggestions && (
        <div aria-live="polite">
          {suggestions.warnings.map((w) => (
            <p key={w} className="warning" role="status">
              {w}
            </p>
          ))}
          <ul className="outfits">
            {suggestions.outfits.map((o) => (
              <OutfitCard
                key={o.outfitId ?? o.garmentIds.join('|')}
                outfit={o}
                garments={suggestions.garments}
                worn={!!o.outfitId && worn.has(o.outfitId)}
                busy={wearBusy}
                onWear={o.outfitId ? () => void toggleWear(o, true) : undefined}
                onUndo={() => void toggleWear(o, false)}
                feedback={o.outfitId ? (ratings.get(o.outfitId) ?? null) : null}
                onRate={o.outfitId ? (rating, tags, comment) => rate(o, rating, tags, comment) : undefined}
              />
            ))}
          </ul>
          {suggestions.outfits.length > 0 && (
            <button type="button" className="btn btn-block" disabled={busy} onClick={() => void run(true)}>
              {busy ? 'Buscando…' : 'Otras opciones'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
