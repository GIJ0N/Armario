import { Check } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { WEARS_LOOKBACK_DAYS } from '../calendar/suggest'
import { layoutsEqual, pruneLayout } from '../canvas/adjust'
import { OCCASION_LABELS, type Garment, type Outfit, type PlanEntry } from '../db'
import type { WearRecord } from '../engine'
import { commitOutfitEdit } from '../outfits/edit'
import { OutfitEditorSheet, type EditorValue } from './OutfitEditorSheet'
import { OutfitVisual } from './OutfitVisual'
import { useRepository } from './RepositoryContext'
import { useToast } from './ToastProvider'

interface State {
  plan: PlanEntry
  outfit: Outfit
  garments: Garment[]
  rotation: WearRecord[]
  /** El plan ya se convirtió en uso hoy. */
  worn: boolean
}

/** Tarjeta compacta de Hoy: el outfit planeado para hoy, con «Me lo pongo» (convierte el plan en uso) y «Cambiar». */
export function PlannedToday({ today }: { today: string }) {
  const repo = useRepository()
  const toast = useToast()
  const [state, setState] = useState<State | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchState = useCallback(async (): Promise<State | null> => {
    const [plan] = await repo.plans.listBetween(today, today)
    if (!plan) return null
    const [outfit, garments, recent] = await Promise.all([
      repo.outfits.get(plan.outfitId),
      repo.list({ statuses: ['active', 'laundry'] }),
      repo.wears.listSince(WEARS_LOOKBACK_DAYS),
    ])
    if (!outfit) return null
    return { plan, outfit, garments, rotation: recent.map((w) => ({ garmentIds: w.garmentIds, date: w.date })), worn: false }
  }, [repo, today])

  useEffect(() => {
    let cancelled = false
    fetchState().then(
      (s) => !cancelled && setState(s),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [fetchState])

  if (!state) return null
  const { plan, outfit, garments, worn } = state
  const byId = new Map(garments.map((g) => [g.id, g]))
  const items = outfit.garment_ids.map((id) => byId.get(id)).filter((g): g is Garment => !!g)
  const title = outfit.name || `Outfit de ${OCCASION_LABELS[outfit.occasion].toLowerCase()}`

  async function wear() {
    setBusy(true)
    setError(null)
    try {
      await repo.plans.convertToWear(plan.id)
      setState((s) => (s ? { ...s, worn: true } : s))
      toast('Outfit marcado como usado')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el uso.')
    } finally {
      setBusy(false)
    }
  }

  /** Deshacer: el uso vuelve a ser un plan para hoy. */
  async function undo() {
    setBusy(true)
    setError(null)
    try {
      await repo.wears.deleteForOutfitOnDate(outfit.id, today)
      const again = await repo.plans.create(outfit.id, today, plan.occasion)
      setState((s) => (s ? { ...s, plan: { ...s.plan, id: again.id }, worn: false } : s))
      toast('Uso deshecho: vuelve a estar planeado')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo deshacer.')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(value: EditorValue) {
    const { outfit: next } = await commitOutfitEdit(repo, {
      original: outfit,
      baseIds: outfit.garment_ids,
      next: { garmentIds: value.garmentIds, occasion: value.occasion, weather: null },
      categoryOf: (id) => byId.get(id)?.category,
      ...(worn ? { wearDate: today } : { planId: plan.id }),
    })
    const layout = pruneLayout(value.canvasLayout, value.garmentIds)
    const current = next.id === outfit.id ? outfit.canvas_layout : (await repo.outfits.get(next.id))?.canvas_layout
    if (!layoutsEqual(current, layout)) await repo.outfits.setCanvasLayout(next.id, layout)
    if (next.saved_at || value.name) await repo.outfits.save(next.id, value.name || undefined)
    const fresh = await fetchState()
    setEditing(false)
    setState(fresh ? { ...fresh, worn } : null)
    toast('Outfit actualizado')
  }

  return (
    <section className="planned-today" aria-label="Planeado para hoy" data-testid="planned-today">
      <div className="saved-canvas">
        <OutfitVisual items={items} size="small" layout={outfit.canvas_layout} />
      </div>
      <div className="saved-info">
        <h2>{worn ? 'Tu outfit de hoy' : 'Planeado para hoy'}</h2>
        <strong className="saved-name">{title}</strong>
        <span className="muted">{OCCASION_LABELS[outfit.occasion]}</span>
        <div className="saved-actions">
          {worn ? (
            <>
              <span className="worn-note" data-testid="planned-worn">
                <Check size={18} aria-hidden="true" />
                Puesto hoy
              </span>
              <button type="button" className="btn btn-quiet btn-inline" disabled={busy} onClick={() => void undo()}>
                Deshacer
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-inline" disabled={busy} onClick={() => void wear()}>
                Me lo pongo
              </button>
              <button type="button" className="btn btn-inline" disabled={busy} onClick={() => setEditing(true)}>
                Cambiar
              </button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
      {editing && (
        <OutfitEditorSheet
          title="Cambiar outfit"
          garments={state.garments}
          wears={state.rotation}
          today={today}
          initial={{ garmentIds: outfit.garment_ids, occasion: outfit.occasion, name: outfit.name ?? '', canvasLayout: outfit.canvas_layout }}
          saveLabel="Guardar cambios"
          onSave={saveEdit}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  )
}
