import { useEffect, useRef, useState } from 'react'
import { useAi } from '../ai/AiProviderContext'
import type { AiProvider } from '../ai/provider'
import { OutfitCard } from '../components/OutfitCard'
import { useRepository } from '../components/RepositoryContext'
import { OCCASIONS, OCCASION_LABELS, type Garment, type Occasion } from '../db'
import { suggestOutfits, type SuggestedOutfit, type Weather } from '../engine'
import { localDateString } from '../lib/date'
import { useSettings } from '../settings'
import {
  loadWeather,
  WEATHER_PRESETS,
  WEATHER_PRESET_KEYS,
  WEATHER_PRESET_LABELS,
  type WeatherPresetKey,
  type WeatherResult,
} from '../weather'

type WeatherState = { status: 'loading' } | { status: 'ready'; result: WeatherResult | null }

interface Suggestions {
  outfits: SuggestedOutfit[]
  garments: Map<string, Garment>
  warnings: string[]
}

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
  const runId = useRef(0)

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
      const saved = await repo.outfits.listRecent(14)
      const recentOutfits = saved.map((o) => ({
        garmentIds: o.garment_ids,
        date: localDateString(new Date(o.created_at)),
      }))
      const today = localDateString()
      if (excludeShown && suggestions) {
        for (const o of suggestions.outfits) recentOutfits.push({ garmentIds: o.garmentIds, date: today })
      }
      let provider: AiProvider | undefined
      if (ai.configured) {
        try {
          provider = ai.getProvider()
        } catch {
          provider = undefined
        }
      }
      const res = await suggestOutfits({ occasion, weather, garments, wears: [], recentOutfits, today }, provider)
      const warnings = [...res.warnings]
      try {
        for (const o of res.outfits) {
          await repo.outfits.create({
            garment_ids: o.garmentIds,
            occasion,
            weather_snapshot: weather,
            reasoning: o.reasoning,
            source: o.source === 'ia' ? 'ai' : 'rules',
          })
        }
      } catch {
        warnings.push('No se pudieron guardar las sugerencias en el historial.')
      }
      if (id !== runId.current) return
      setSuggestions({ outfits: res.outfits, garments: new Map(garments.map((g) => [g.id, g])), warnings })
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : 'No se pudieron generar los outfits.')
    } finally {
      if (id === runId.current) setBusy(false)
    }
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
              <OutfitCard key={o.garmentIds.join('|')} outfit={o} garments={suggestions.garments} />
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
