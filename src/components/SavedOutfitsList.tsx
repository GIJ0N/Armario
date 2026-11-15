import { Bookmark } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { OCCASION_LABELS, type Garment, type SavedOutfit } from '../db'
import { commitOutfitEdit } from '../outfits/edit'
import { localDateString } from '../lib/date'
import { pruneLayout, layoutsEqual, type AdjustChange } from '../canvas/adjust'
import { LaundrySheet } from './LaundrySheet'
import { OutfitAdjustSheet } from './OutfitAdjustSheet'
import { OutfitEditorSheet, type EditorValue } from './OutfitEditorSheet'
import { OutfitVisual } from './OutfitVisual'
import { useRepository } from './RepositoryContext'
import { SkeletonBlock } from './Skeleton'
import { useToast } from './ToastProvider'
import type { WearRecord } from '../engine'

const WEARS_LOOKBACK_DAYS = 60

function lastWornLabel(date: string | null): string {
  if (!date) return 'Aún sin usar'
  const [y, m, d] = date.split('-').map(Number)
  return `Último uso: ${new Date(y, m - 1, d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`
}

interface Props {
  /** Se incrementa para recargar la lista desde fuera (p. ej. tras «Crear outfit»). */
  reloadKey?: number
}

/** Armario › Outfits: outfits guardados como lienzos pequeños con «Usar hoy», «Editar» y «Quitar de guardados». */
export function SavedOutfitsList({ reloadKey = 0 }: Props) {
  const repo = useRepository()
  const toast = useToast()
  const [saved, setSaved] = useState<SavedOutfit[] | null>(null)
  const [garments, setGarments] = useState<Garment[]>([])
  const [wears, setWears] = useState<WearRecord[]>([])
  const [editing, setEditing] = useState<SavedOutfit | null>(null)
  const [adjusting, setAdjusting] = useState<SavedOutfit | null>(null)
  const [laundry, setLaundry] = useState<Garment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    const [list, all, wearEntries] = await Promise.all([
      repo.outfits.listSaved(),
      repo.list({ statuses: ['active', 'laundry'] }),
      repo.wears.listSince(WEARS_LOOKBACK_DAYS),
    ])
    return { list, all, wears: wearEntries.map((w) => ({ garmentIds: w.garmentIds, date: w.date })) }
  }, [repo])

  const apply = useCallback((data: Awaited<ReturnType<typeof fetchAll>>) => {
    setGarments(data.all)
    setWears(data.wears)
    setSaved(data.list)
  }, [])

  const load = useCallback(async () => apply(await fetchAll()), [apply, fetchAll])

  useEffect(() => {
    let cancelled = false
    fetchAll().then(
      (data) => !cancelled && apply(data),
      (e) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudieron cargar los outfits.'),
    )
    return () => {
      cancelled = true
    }
  }, [fetchAll, apply, reloadKey])

  const byId = new Map(garments.map((g) => [g.id, g]))
  const itemsOf = (s: SavedOutfit) => s.outfit.garment_ids.map((id) => byId.get(id)).filter((g): g is Garment => !!g)

  async function wearToday(s: SavedOutfit) {
    setError(null)
    try {
      // Usar un outfit guardado siempre se permite: la regla de no repetir 14 días es solo de las sugerencias.
      await repo.wears.create(s.outfit.id, localDateString())
      const items = itemsOf(s)
      toast('Outfit marcado como usado hoy', { label: 'Mandar a lavandería', onAction: () => setLaundry(items) })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el uso.')
    }
  }

  async function unsave(s: SavedOutfit) {
    setError(null)
    try {
      await repo.outfits.unsave(s.outfit.id)
      toast('Quitado de guardados')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
  }

  async function saveEdit(s: SavedOutfit, value: EditorValue) {
    const before = s.outfit.garment_ids
    const unchanged =
      value.occasion === s.outfit.occasion &&
      before.length === value.garmentIds.length &&
      before.every((id) => value.garmentIds.includes(id))
    let id = s.outfit.id
    // Solo cambió el nombre: no se crea otra fila.
    if (!unchanged) {
      const { outfit } = await commitOutfitEdit(repo, {
        original: s.outfit,
        baseIds: before,
        next: { garmentIds: value.garmentIds, occasion: value.occasion, weather: null },
        categoryOf: (gid) => byId.get(gid)?.category,
      })
      id = outfit.id
    }
    // Ajustes de lienzo editados en la hoja (la fila nueva ya arrastra los de las prendas que se conservan).
    const layout = pruneLayout(value.canvasLayout, value.garmentIds)
    const current = id === s.outfit.id ? s.outfit.canvas_layout : (await repo.outfits.get(id))?.canvas_layout
    if (!layoutsEqual(current, layout)) await repo.outfits.setCanvasLayout(id, layout)
    await repo.outfits.save(id, value.name || undefined)
    setEditing(null)
    toast('Outfit actualizado')
    await load()
  }

  async function saveAdjust(s: SavedOutfit, change: AdjustChange) {
    setAdjusting(null)
    try {
      await repo.outfits.setCanvasLayout(s.outfit.id, change.layout)
      for (const [id, adj] of Object.entries(change.garments)) await repo.setCanvasAdjust(id, adj)
      toast('Ajuste guardado')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el ajuste.')
    }
    await load()
  }

  async function sendToLaundry(ids: string[]) {
    for (const id of ids) await repo.setStatus(id, 'laundry')
    setLaundry(null)
    toast(ids.length === 1 ? 'Prenda enviada a lavandería' : `${ids.length} prendas enviadas a lavandería`)
    await load()
  }

  if (!saved) return <SkeletonBlock height={240} />
  return (
    <>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {saved.length === 0 ? (
        <div className="empty">
          <Bookmark size={40} strokeWidth={1.3} aria-hidden="true" />
          <p>Aún no tienes outfits guardados. Guarda uno desde Hoy o crea uno con «Crear outfit».</p>
        </div>
      ) : (
        <ul className="saved-list" aria-label="Outfits guardados">
          {saved.map((s) => {
            const items = itemsOf(s)
            const title = s.outfit.name || `Outfit de ${OCCASION_LABELS[s.outfit.occasion].toLowerCase()}`
            return (
              <li key={s.outfit.id} className="saved-card" data-testid="saved-outfit">
                <div className="saved-canvas">
                  <OutfitVisual
                    items={items}
                    size="small"
                    layout={s.outfit.canvas_layout}
                    onAdjustRequest={() => setAdjusting(s)}
                    shareable
                  />
                </div>
                <div className="saved-info">
                  <strong className="saved-name" data-testid="saved-name">
                    {title}
                  </strong>
                  <span className="muted">{OCCASION_LABELS[s.outfit.occasion]}</span>
                  <span className="muted" data-testid="saved-last-worn">
                    {lastWornLabel(s.lastWorn)}
                  </span>
                  <div className="saved-actions">
                    <button type="button" className="btn btn-primary btn-inline" onClick={() => void wearToday(s)}>
                      Usar hoy
                    </button>
                    <button type="button" className="btn btn-inline" onClick={() => setEditing(s)}>
                      Editar
                    </button>
                    <button type="button" className="btn btn-quiet btn-inline" onClick={() => void unsave(s)}>
                      Quitar de guardados
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing && (
        <OutfitEditorSheet
          title="Editar outfit"
          garments={garments}
          wears={wears}
          today={localDateString()}
          initial={{
            garmentIds: editing.outfit.garment_ids,
            occasion: editing.outfit.occasion,
            name: editing.outfit.name ?? '',
            canvasLayout: editing.outfit.canvas_layout,
          }}
          saveLabel="Guardar cambios"
          onSave={(value) => saveEdit(editing, value)}
          onClose={() => setEditing(null)}
        />
      )}
      {adjusting && (
        <OutfitAdjustSheet
          items={itemsOf(adjusting)}
          layout={adjusting.outfit.canvas_layout}
          onSave={(change) => saveAdjust(adjusting, change)}
          onClose={() => setAdjusting(null)}
        />
      )}
      {laundry && <LaundrySheet items={laundry} onConfirm={sendToLaundry} onClose={() => setLaundry(null)} />}
    </>
  )
}
