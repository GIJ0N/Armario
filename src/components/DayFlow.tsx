import { CalendarClock, Check, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_WEEKDAY_OCCASION, defaultOccasionFor } from '../calendar/planWeek'
import { WEARS_LOOKBACK_DAYS } from '../calendar/suggest'
import { capitalize, longDayLabel } from '../calendar/grid'
import { pruneLayout, layoutsEqual } from '../canvas/adjust'
import {
  OCCASION_LABELS,
  type Garment,
  type Occasion,
  type Outfit,
  type OutfitInput,
  type PlanEntry,
  type SavedOutfit,
  type WearEntry,
} from '../db'
import type { WearRecord } from '../engine'
import { commitOutfitEdit, createManualOutfit } from '../outfits/edit'
import { NEUTRAL_WEATHER_NOTE, weatherForDate, type DailyForecastResult } from '../weather'
import { BottomSheet } from './BottomSheet'
import { SavedPicker, SuggestView } from './DayViews'
import { OutfitEditFlow, type EditContext } from './OutfitEditFlow'
import { OutfitEditorSheet, type EditorValue } from './OutfitEditorSheet'
import { OutfitVisual } from './OutfitVisual'
import { useRepository } from './RepositoryContext'
import { SaveOutfitSheet } from './SaveOutfitSheet'
import { useToast } from './ToastProvider'

type Entry = { kind: 'wear'; wear: WearEntry } | { kind: 'plan'; plan: PlanEntry }

type View =
  | { kind: 'day' }
  | { kind: 'add' }
  | { kind: 'saved' }
  | { kind: 'create' }
  | { kind: 'suggest' }
  | { kind: 'save'; entry: Entry }
  | { kind: 'edit'; entry: Entry }
  | { kind: 'swap'; entry: Entry; garmentId: string }

interface Props {
  /** YYYY-MM-DD */
  date: string
  today: string
  wears: WearEntry[]
  plans: PlanEntry[]
  /** Todas las prendas (cualquier estado) para dibujar lo ya registrado. */
  garments: Garment[]
  forecast: DailyForecastResult | null
  /** Recarga los datos del calendario tras un cambio (se espera antes de avisar). */
  onChanged: () => Promise<void>
  onClose: () => void
}

const entryOutfitId = (e: Entry) => (e.kind === 'wear' ? e.wear.outfitId : e.plan.outfitId)
const entryGarmentIds = (e: Entry) => (e.kind === 'wear' ? e.wear.garmentIds : e.plan.garmentIds)
const entryKey = (e: Entry) => (e.kind === 'wear' ? `w-${e.wear.wearId}` : `p-${e.plan.id}`)

/** Hoja del día: lo usado y lo planeado ese día, con sus acciones, y «Agregar outfit» (guardados, crear o sugerir). */
export function DayFlow({ date, today, wears, plans, garments, forecast, onChanged, onClose }: Props) {
  const repo = useRepository()
  const toast = useToast()
  const [view, setView] = useState<View>({ kind: 'day' })
  const [outfits, setOutfits] = useState<Map<string, Outfit>>(new Map())
  const [saved, setSaved] = useState<SavedOutfit[] | null>(null)
  const [pool, setPool] = useState<Garment[]>([])
  const [rotation, setRotation] = useState<WearRecord[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPast = date <= today
  const verb = isPast ? 'usado' : 'planeado'
  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments])
  const entries: Entry[] = useMemo(
    () => [...wears.map((wear): Entry => ({ kind: 'wear', wear })), ...plans.map((plan): Entry => ({ kind: 'plan', plan }))],
    [wears, plans],
  )
  const outfitIds = useMemo(() => [...new Set(entries.map(entryOutfitId))].sort().join(','), [entries])
  const dw = weatherForDate(forecast, date)

  // Filas de outfit (nombre, guardado, lienzo) de lo que se ve en el día.
  useEffect(() => {
    let cancelled = false
    const ids = outfitIds ? outfitIds.split(',') : []
    void Promise.all(ids.map((id) => repo.outfits.get(id))).then((rows) => {
      if (!cancelled) setOutfits(new Map(rows.filter((o): o is Outfit => !!o).map((o) => [o.id, o])))
    })
    return () => {
      cancelled = true
    }
  }, [repo, outfitIds])

  // Datos para elegir y editar: guardados, prendas activas y en lavandería, usos recientes.
  useEffect(() => {
    let cancelled = false
    void Promise.all([repo.outfits.listSaved(), repo.list({ statuses: ['active', 'laundry'] }), repo.wears.listSince(WEARS_LOOKBACK_DAYS)]).then(
      ([list, all, recent]) => {
        if (cancelled) return
        setSaved(list)
        setPool(all)
        setRotation(recent.map((w) => ({ garmentIds: w.garmentIds, date: w.date })))
      },
    )
    return () => {
      cancelled = true
    }
  }, [repo, outfitIds])

  const run = useCallback(
    async (action: () => Promise<string | void>) => {
      setBusy(true)
      setError(null)
      try {
        const message = await action()
        await onChanged()
        // El aviso sale cuando lo escrito ya está en la base (después de esperar el repositorio).
        if (message) toast(message)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio.')
      } finally {
        setBusy(false)
      }
    },
    [onChanged, toast],
  )

  const backToDay = () => setView({ kind: 'day' })

  /** Registra un outfit en este día: usado si es hoy o pasado, planeado si es futuro. */
  async function register(outfit: Outfit): Promise<string> {
    if (isPast) {
      await repo.wears.create(outfit.id, date)
      return date === today ? 'Outfit marcado como usado hoy' : 'Uso registrado en el calendario'
    }
    await repo.plans.create(outfit.id, date, outfit.occasion)
    return 'Outfit planeado'
  }

  async function pickSaved(outfit: Outfit) {
    const message = await register(outfit)
    await onChanged()
    toast(message)
    backToDay()
  }

  async function pickSuggested(input: OutfitInput) {
    const outfit = await repo.outfits.create(input)
    const message = await register(outfit)
    await onChanged()
    toast(message)
    backToDay()
  }

  async function createOutfit(value: EditorValue) {
    const outfit = await createManualOutfit(repo, {
      garmentIds: value.garmentIds,
      occasion: value.occasion,
      name: value.name || undefined,
      canvasLayout: value.canvasLayout,
      categoryOf: (id) => pool.find((g) => g.id === id)?.category,
    })
    const message = await register(outfit)
    await onChanged()
    toast(message)
    backToDay()
  }

  /** Aplica una edición al outfit de un uso o de un plan: si el outfit tiene historia se crea una fila nueva y el día se mueve a ella. */
  async function applyEdit(entry: Entry, original: Outfit, garmentIds: string[], occasion: Occasion, value?: EditorValue) {
    const { outfit } = await commitOutfitEdit(repo, {
      original,
      baseIds: entryGarmentIds(entry),
      next: { garmentIds, occasion, weather: dw.source === 'forecast' ? dw.weather : null },
      categoryOf: (id) => byId.get(id)?.category,
      ...(entry.kind === 'plan' ? { planId: entry.plan.id } : { wearDate: date }),
    })
    if (value) {
      const layout = pruneLayout(value.canvasLayout, garmentIds)
      const current = outfit.id === original.id ? original.canvas_layout : (await repo.outfits.get(outfit.id))?.canvas_layout
      if (!layoutsEqual(current, layout)) await repo.outfits.setCanvasLayout(outfit.id, layout)
      if (outfit.saved_at || value.name) await repo.outfits.save(outfit.id, value.name || undefined)
    }
  }

  const entryCard = (entry: Entry) => {
    const outfit = outfits.get(entryOutfitId(entry))
    const items = entryGarmentIds(entry)
      .map((id) => byId.get(id))
      .filter((g): g is Garment => !!g)
    const occasion = outfit?.occasion ?? (entry.kind === 'wear' ? entry.wear.occasion : entry.plan.outfitOccasion)
    const title = outfit?.name || `Outfit de ${OCCASION_LABELS[occasion].toLowerCase()}`
    const isWear = entry.kind === 'wear'
    return (
      <li key={entryKey(entry)} className="saved-card day-entry" data-testid="day-entry" data-kind={entry.kind}>
        <div className="saved-canvas">
          <OutfitVisual
            items={items}
            size="small"
            layout={outfit?.canvas_layout}
            onSelectGarment={(id) => setView({ kind: 'swap', entry, garmentId: id })}
          />
        </div>
        <div className="saved-info">
          <span className={`badge ${isWear ? 'badge-worn' : 'badge-planned'}`} data-testid="entry-state">
            {isWear ? <Check size={12} strokeWidth={3} aria-hidden="true" /> : <CalendarClock size={12} strokeWidth={2.4} aria-hidden="true" />}
            {isWear ? 'Usado' : 'Planeado'}
          </span>
          <strong className="saved-name" data-testid="entry-name">
            {title}
          </strong>
          {outfit?.name && <span className="muted">{OCCASION_LABELS[occasion]}</span>}
          <div className="saved-actions">
            {isWear ? (
              <>
                <button
                  type="button"
                  className="btn btn-inline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await repo.wears.deleteForOutfitOnDate(entry.wear.outfitId, date)
                      return 'Uso quitado del día'
                    })
                  }
                >
                  Quitar del día
                </button>
                {outfit && !outfit.saved_at && (
                  <button type="button" className="btn btn-inline" disabled={busy} onClick={() => setView({ kind: 'save', entry })}>
                    Guardar outfit
                  </button>
                )}
                <button type="button" className="btn btn-quiet btn-inline" disabled={busy || !outfit} onClick={() => setView({ kind: 'edit', entry })}>
                  Cambiar
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-inline"
                  disabled={busy || !isPast}
                  title={isPast ? undefined : 'Disponible a partir de ese día'}
                  onClick={() =>
                    void run(async () => {
                      await repo.plans.convertToWear(entry.plan.id)
                      return 'Outfit marcado como usado'
                    })
                  }
                >
                  Me lo puse
                </button>
                {!isPast && <span className="muted day-hint">Podrás marcarlo ese día.</span>}
                <button type="button" className="btn btn-inline" disabled={busy || !outfit} onClick={() => setView({ kind: 'edit', entry })}>
                  Cambiar
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-inline"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await repo.plans.remove(entry.plan.id)
                      return 'Quitado del plan'
                    })
                  }
                >
                  Quitar del plan
                </button>
              </>
            )}
          </div>
        </div>
      </li>
    )
  }

  const title = capitalize(longDayLabel(date))
  const weatherLabel =
    dw.source === 'forecast'
      ? `${date === today ? 'Hoy · ' : ''}${Math.round(dw.day.tempMinC)}° a ${Math.round(dw.day.tempMaxC)}° · lluvia ${Math.round(dw.day.precipProbability)}%`
      : date >= today
        ? `${date === today ? 'Hoy · ' : ''}${capitalize(NEUTRAL_WEATHER_NOTE)}`
        : ''

  if (view.kind === 'saved') {
    return <SavedPicker date={date} garments={new Map(pool.map((g) => [g.id, g]))} saved={saved} verb={verb} onPick={pickSaved} onBack={backToDay} />
  }
  if (view.kind === 'suggest') {
    return (
      <SuggestView
        date={date}
        defaultOccasion={defaultOccasionFor(date, DEFAULT_WEEKDAY_OCCASION)}
        forecast={forecast}
        verb={verb}
        onPick={pickSuggested}
        onBack={backToDay}
      />
    )
  }
  if (view.kind === 'create') {
    return (
      <OutfitEditorSheet
        title="Crear outfit"
        garments={pool}
        wears={rotation}
        today={date}
        saveLabel={isPast ? 'Guardar y registrar como usado' : 'Guardar y planear'}
        onSave={createOutfit}
        onClose={backToDay}
      />
    )
  }
  if (view.kind === 'save') {
    const id = entryOutfitId(view.entry)
    return (
      <SaveOutfitSheet
        onSave={async (name) => {
          await repo.outfits.save(id, name || undefined)
          await onChanged()
          toast('Outfit guardado en Armario › Outfits')
          backToDay()
        }}
        onClose={backToDay}
      />
    )
  }
  if (view.kind === 'edit') {
    const entry = view.entry
    const original = outfits.get(entryOutfitId(entry))
    if (!original) return null
    return (
      <OutfitEditorSheet
        title="Cambiar outfit"
        garments={pool}
        wears={rotation}
        today={date}
        initial={{
          garmentIds: entryGarmentIds(entry),
          occasion: original.occasion,
          name: original.name ?? '',
          canvasLayout: original.canvas_layout,
        }}
        saveLabel="Guardar cambios"
        onSave={async (value) => {
          await applyEdit(entry, original, value.garmentIds, value.occasion, value)
          await onChanged()
          toast('Outfit actualizado')
          backToDay()
        }}
        onClose={backToDay}
      />
    )
  }
  if (view.kind === 'swap') {
    const entry = view.entry
    const original = outfits.get(entryOutfitId(entry))
    const items = entryGarmentIds(entry)
      .map((id) => pool.find((g) => g.id === id) ?? byId.get(id))
      .filter((g): g is Garment => !!g)
    if (!original) return null
    const ctx: EditContext = {
      occasion: original.occasion,
      weather: dw.source === 'forecast' ? dw.weather : null,
      garments: pool,
      wears: rotation,
      today: date,
    }
    return (
      <OutfitEditFlow
        ctx={ctx}
        items={items}
        target={{ kind: 'swap', garmentId: view.garmentId }}
        onApply={(next, summary) => {
          backToDay()
          void run(async () => {
            await applyEdit(entry, original, next.map((g) => g.id), original.occasion)
            return summary
          })
        }}
        onClose={backToDay}
      />
    )
  }
  if (view.kind === 'add') {
    return (
      <BottomSheet title="Agregar outfit" onClose={backToDay}>
        <p className="page-hint sheet-lead">
          Quedará {verb} el {longDayLabel(date)}.
        </p>
        <div className="sheet-actions sheet-actions-column">
          <button type="button" className="btn" onClick={() => setView({ kind: 'saved' })}>
            Elegir de mis guardados
          </button>
          <button type="button" className="btn" onClick={() => setView({ kind: 'create' })}>
            Crear outfit
          </button>
          <button type="button" className="btn" onClick={() => setView({ kind: 'suggest' })}>
            Sugerir
          </button>
          <button type="button" className="btn btn-quiet" onClick={backToDay}>
            Volver
          </button>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet title={title} onClose={onClose}>
      {weatherLabel && (
        <p className="cal-weather" data-testid="day-weather">
          {weatherLabel}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="page-hint sheet-lead">{isPast ? 'No registraste ningún outfit este día.' : 'Todavía no hay nada planeado.'}</p>
      ) : (
        <ul className="saved-list day-list" aria-label="Outfits del día">
          {entries.map(entryCard)}
        </ul>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setView({ kind: 'add' })}>
          <Plus size={18} aria-hidden="true" />
          Agregar outfit
        </button>
      </div>
    </BottomSheet>
  )
}
