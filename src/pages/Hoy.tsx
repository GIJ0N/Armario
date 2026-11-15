import { Cloud, CloudRain, Heart, RotateCcw, SlidersHorizontal, Sparkles, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useAi } from '../ai/AiProviderContext'
import type { AiProvider } from '../ai/provider'
import { pruneLayout, type AdjustChange, type OutfitLayout } from '../canvas/adjust'
import { LaundrySheet } from '../components/LaundrySheet'
import { subscribeCutoutChanged } from '../cutout/events'
import { OutfitEditFlow, type EditTarget } from '../components/OutfitEditFlow'
import { OutfitCard, type CardOutfit } from '../components/OutfitCard'
import { OutfitCarousel } from '../components/OutfitCarousel'
import { SaveOutfitSheet } from '../components/SaveOutfitSheet'
import { useRepository } from '../components/RepositoryContext'
import { useToast } from '../components/ToastProvider'
import { OCCASIONS, OCCASION_LABELS, type FeedbackEntry, type Garment, type Occasion, type Rating } from '../db'
import { daysBetween, NO_REPEAT_DAYS, suggestOutfits, type Weather, type WearRecord } from '../engine'
import { commitOutfitEdit } from '../outfits/edit'
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
type ShownOutfit = CardOutfit & {
  outfitId: string | null
  saved: boolean
  name: string | null
  /** Ajustes manuales del lienzo (fase 13a); se guardan con la fila del outfit o, si aún no existe, al guardarlo. */
  canvasLayout: OutfitLayout | null
}

interface Suggestions {
  outfits: ShownOutfit[]
  /** Activas y en lavandería (las alternativas de la edición incluyen estas últimas). */
  garments: Map<string, Garment>
  warnings: string[]
  occasion: Occasion
  weather: Weather
  wears: WearRecord[]
  today: string
}

const outfitKey = (o: ShownOutfit) => o.outfitId ?? o.garmentIds.join('|')

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
  const [settings, updateSettings] = useSettings()
  const toast = useToast()
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
  const [editing, setEditing] = useState<{ key: string; target: EditTarget } | null>(null)
  const [saving, setSaving] = useState<ShownOutfit | null>(null)
  const [laundryFor, setLaundryFor] = useState<ShownOutfit | null>(null)
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null)
  const runId = useRef(0)
  /** Outfits ya mostrados en esta sesión (solo en memoria): «Otras opciones» no los repite. */
  const shown = useRef<string[][]>([])

  // Un recorte nuevo (en segundo plano o pegado) se refleja en las tarjetas ya mostradas.
  useEffect(
    () =>
      subscribeCutoutChanged((id) => {
        void repo.get(id).then((fresh) => {
          if (!fresh) return
          setSuggestions((cur) => {
            const old = cur?.garments.get(id)
            if (!cur || !old) return cur
            return { ...cur, garments: new Map(cur.garments).set(id, { ...old, cutout_path: fresh.cutout_path, cutout_kind: fresh.cutout_kind }) }
          })
        })
      }),
    [repo],
  )

  // El chip de ocasión activo se centra en la fila deslizable.
  const activeChip = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeChip.current?.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [occasion])

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

  function clearManual() {
    setManual(null)
    shown.current = []
    setSuggestions(null)
  }

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
      const pool = await repo.list({ statuses: ['active', 'laundry'] })
      const garments = pool.filter((g) => g.status === 'active')
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
          ...(settings.requireFavorite ? { requireFavorite: true } : {}),
          ...(taste
            ? { taste: taste.preferences, tasteSummary: taste.summary, likedOutfits: taste.likedOutfits }
            : {}),
        },
        provider,
      )
      const warnings = [...res.warnings]
      const outfits: ShownOutfit[] = res.outfits.map((o) => ({ ...o, outfitId: null, saved: false, name: null, canvasLayout: null }))
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
      setSuggestions({
        outfits,
        garments: new Map(pool.map((g) => [g.id, g])),
        warnings,
        occasion,
        weather,
        wears: wears.map((w) => ({ garmentIds: w.garmentIds, date: w.date })),
        today,
      })
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
      toast(on ? 'Outfit marcado como usado' : 'Uso deshecho')
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

  function replaceOutfit(key: string, next: ShownOutfit) {
    setSuggestions((cur) => (cur ? { ...cur, outfits: cur.outfits.map((x) => (outfitKey(x) === key ? next : x)) } : cur))
  }

  /** Aplica un cambio manual: actualiza el lienzo al instante y guarda según la regla de edición. */
  async function applyEdit(o: ShownOutfit, next: Garment[], summary: string) {
    if (!suggestions) return
    const key = outfitKey(o)
    const ids = next.map((g) => g.id)
    setEditing(null)
    // Vista previa inmediata; si falla el guardado se muestra un aviso y se conserva lo editado.
    replaceOutfit(key, { ...o, garmentIds: ids, source: 'manual', canvasLayout: pruneLayout(o.canvasLayout, ids) })
    try {
      const original = o.outfitId ? await repo.outfits.get(o.outfitId) : null
      const { outfit, createdNew } = await commitOutfitEdit(repo, {
        original,
        baseIds: o.garmentIds,
        next: { garmentIds: ids, occasion: suggestions.occasion, weather: suggestions.weather },
        categoryOf: (id) => suggestions.garments.get(id)?.category,
      })
      // Si ya la llevabas hoy, el uso de hoy pasa al outfit corregido (no se cuenta dos veces).
      let wasWorn = false
      if (createdNew && o.outfitId && worn.has(o.outfitId)) {
        wasWorn = true
        await repo.wears.deleteForOutfitOnDate(o.outfitId, suggestions.today)
        await repo.wears.create(outfit.id, suggestions.today)
      }
      shown.current.push(ids)
      setWorn((prev) => {
        const nextSet = new Set(prev)
        if (o.outfitId) nextSet.delete(o.outfitId)
        if (wasWorn) nextSet.add(outfit.id)
        return nextSet
      })
      replaceOutfit(key, {
        garmentIds: ids,
        reasoning: outfit.reasoning,
        source: 'manual',
        outfitId: outfit.id,
        saved: !!outfit.saved_at,
        name: outfit.name ?? null,
        canvasLayout: outfit.canvas_layout ?? pruneLayout(o.canvasLayout, ids),
      })
      toast(summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio.')
    }
  }

  /** Guarda el outfit en Armario › Outfits; si todavía no está en el historial, primero lo crea. */
  async function saveOutfit(o: ShownOutfit, name: string) {
    if (!suggestions) return
    let id = o.outfitId
    if (!id) {
      const created = await repo.outfits.create({
        garment_ids: o.garmentIds,
        occasion: suggestions.occasion,
        weather_snapshot: suggestions.weather,
        reasoning: o.reasoning,
        source: o.source === 'ia' ? 'ai' : o.source === 'manual' ? 'manual' : 'rules',
      })
      id = created.id
      if (o.canvasLayout) await repo.outfits.setCanvasLayout(id, o.canvasLayout)
    }
    const saved = await repo.outfits.save(id, name || undefined)
    replaceOutfit(outfitKey(o), { ...o, outfitId: saved.id, saved: true, name: saved.name ?? null })
    setSaving(null)
    toast('Outfit guardado en Armario › Outfits')
  }

  async function unsaveOutfit(o: ShownOutfit) {
    if (!o.outfitId) return
    try {
      await repo.outfits.unsave(o.outfitId)
      replaceOutfit(outfitKey(o), { ...o, saved: false, name: null })
      toast('Quitado de guardados')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
  }

  /** «Listo» del modo Ajustar: se ve al instante y luego se guarda (outfit en su fila o en memoria; prendas al momento). */
  async function adjustOutfit(o: ShownOutfit, change: AdjustChange) {
    replaceOutfit(outfitKey(o), { ...o, canvasLayout: change.layout })
    const garmentIds = Object.keys(change.garments)
    if (garmentIds.length > 0) {
      setSuggestions((cur) => {
        if (!cur) return cur
        const garments = new Map(cur.garments)
        for (const id of garmentIds) {
          const g = garments.get(id)
          if (g) garments.set(id, { ...g, canvas_adjust: change.garments[id] })
        }
        return { ...cur, garments }
      })
    }
    try {
      if (o.outfitId) await repo.outfits.setCanvasLayout(o.outfitId, change.layout)
      for (const id of garmentIds) await repo.setCanvasAdjust(id, change.garments[id])
      // El aviso sale cuando ya quedó guardado (no antes), para no perder el ajuste si se cierra la app enseguida.
      if (o.outfitId || garmentIds.length > 0) toast('Ajuste guardado')
    } catch {
      setError('No se pudo guardar el ajuste del lienzo.')
    }
  }

  async function sendToLaundry(ids: string[]) {
    for (const id of ids) await repo.setStatus(id, 'laundry')
    setSuggestions((cur) => {
      if (!cur) return cur
      const garments = new Map(cur.garments)
      for (const id of ids) {
        const g = garments.get(id)
        if (g) garments.set(id, { ...g, status: 'laundry' })
      }
      return { ...cur, garments }
    })
    setLaundryFor(null)
    toast(ids.length === 1 ? 'Prenda enviada a lavandería' : `${ids.length} prendas enviadas a lavandería`)
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

      <div className="chips chips-scroll" role="group" aria-label="Ocasión">
        {OCCASIONS.map((o) => (
          <button
            key={o}
            ref={o === occasion ? activeChip : undefined}
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
          <div className="weather-row">
            {weather.isRaining || weather.precipProbability >= 50 ? (
              <CloudRain className="icon" size={26} aria-hidden="true" />
            ) : weather.tempC < 16 ? (
              <Cloud className="icon" size={26} aria-hidden="true" />
            ) : (
              <Sun className="icon" size={26} aria-hidden="true" />
            )}
            <strong className="weather-temp">{deg(weather.tempC)}</strong>
            <div className="weather-detail">
              <span>
                Mín {deg(weather.tempMinC)} · Máx {deg(weather.tempMaxC)}
              </span>
              <span className="muted weather-note">
                Lluvia {Math.round(weather.precipProbability)}%{weather.isRaining ? ' (llueve ahora)' : ''} ·{' '}
                {manual
                  ? `Clima manual: ${WEATHER_PRESET_LABELS[manual]}`
                  : loaded?.origin === 'antiguo'
                    ? `Sin conexión: clima guardado ${ageLabel(loaded.ageMs)} en ${loaded.city}`
                    : loaded?.origin === 'cache'
                      ? `${loaded.city} (guardado)`
                      : (loaded?.city ?? '')}
              </span>
            </div>
            {!showPresets && weatherState.status === 'ready' && (
              <button
                type="button"
                className="icon-btn"
                aria-label={manual ? 'Usar clima real' : 'Cambiar clima'}
                title={manual ? 'Usar clima real' : 'Cambiar clima'}
                onClick={() => (manual ? clearManual() : setPicking(true))}
              >
                {manual ? <RotateCcw size={20} aria-hidden="true" /> : <SlidersHorizontal size={20} aria-hidden="true" />}
              </button>
            )}
          </div>
        )}
        {weatherState.status === 'ready' && !weather && (
          <p className="page-hint">No se pudo obtener el clima. Elige uno:</p>
        )}
        {showPresets && (
          <div className="chips chips-scroll" role="group" aria-label="Clima manual">
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
        )}
      </div>

      <button
        type="button"
        className={`chip chip-toggle${settings.requireFavorite ? ' chip-active' : ''}`}
        aria-pressed={settings.requireFavorite}
        onClick={() => updateSettings({ requireFavorite: !settings.requireFavorite })}
      >
        <Heart size={16} aria-hidden="true" fill={settings.requireFavorite ? 'currentColor' : 'none'} />
        Con una favorita
      </button>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy || !weather}
        onClick={() => void run(false)}
      >
        <Sparkles size={18} aria-hidden="true" />
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
          <OutfitCarousel locked={adjustingKey !== null}>
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
                onSelectGarment={(id) => setEditing({ key: outfitKey(o), target: { kind: 'swap', garmentId: id } })}
                onAdd={() => setEditing({ key: outfitKey(o), target: { kind: 'add' } })}
                saved={o.saved}
                onToggleSave={() => (o.saved ? void unsaveOutfit(o) : setSaving(o))}
                onLaundry={() => setLaundryFor(o)}
                layout={o.canvasLayout}
                onAdjustSave={(change) => adjustOutfit(o, change)}
                onAdjustingChange={(a) => setAdjustingKey((cur) => (a ? outfitKey(o) : cur === outfitKey(o) ? null : cur))}
                shareable
              />
            ))}
          </OutfitCarousel>
          {suggestions.outfits.length > 0 && (
            <button type="button" className="btn btn-block" disabled={busy} onClick={() => void run(true)}>
              {busy ? 'Buscando…' : 'Otras opciones'}
            </button>
          )}
        </div>
      )}
      {suggestions && editing && (() => {
        const o = suggestions.outfits.find((x) => outfitKey(x) === editing.key)
        if (!o) return null
        const items = o.garmentIds.map((id) => suggestions.garments.get(id)).filter((g): g is Garment => !!g)
        return (
          <OutfitEditFlow
            ctx={{
              occasion: suggestions.occasion,
              weather: suggestions.weather,
              garments: [...suggestions.garments.values()],
              wears: suggestions.wears,
              today: suggestions.today,
            }}
            items={items}
            target={editing.target}
            onApply={(next, summary) => void applyEdit(o, next, summary)}
            onClose={() => setEditing(null)}
          />
        )
      })()}
      {saving && <SaveOutfitSheet onSave={(name) => saveOutfit(saving, name)} onClose={() => setSaving(null)} />}
      {suggestions && laundryFor && (
        <LaundrySheet
          items={laundryFor.garmentIds.map((id) => suggestions.garments.get(id)).filter((g): g is Garment => !!g)}
          onConfirm={(ids) => sendToLaundry(ids)}
          onClose={() => setLaundryFor(null)}
        />
      )}
    </section>
  )
}
