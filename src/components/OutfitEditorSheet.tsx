import { Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  OCCASIONS,
  OCCASION_LABELS,
  type Category,
  type Garment,
  type Occasion,
} from '../db'
import { structureIssues, validateManualOutfit, type WearRecord } from '../engine'
import { BottomSheet } from './BottomSheet'
import { OutfitVisual } from './OutfitVisual'
import { SlotPicker, type EditContext } from './OutfitEditFlow'

export interface EditorValue {
  garmentIds: string[]
  occasion: Occasion
  name: string
}

interface Props {
  title: string
  /** Prendas disponibles (activas y en lavandería). */
  garments: Garment[]
  wears: WearRecord[]
  today: string
  initial?: { garmentIds: string[]; occasion: Occasion; name: string }
  saveLabel?: string
  onSave: (value: EditorValue) => Promise<void> | void
  onClose: () => void
}

type Picking = { category: Category; replaceId: string | null }

const REQUIRED: { category: Category; label: string }[] = [
  { category: 'top', label: 'Superior' },
  { category: 'bottom', label: 'Inferior' },
  { category: 'shoes', label: 'Calzado' },
]
const garmentName = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

/**
 * Editor de un outfit completo (Crear outfit y Editar un guardado): ocasión, las tres piezas obligatorias y
 * piezas opcionales (una capa exterior, hasta 2 accesorios). Elegir una pieza reutiliza la lista de alternativas.
 */
export function OutfitEditorSheet({ title, garments, wears, today, initial, saveLabel = 'Guardar outfit', onSave, onClose }: Props) {
  const [occasion, setOccasion] = useState<Occasion>(initial?.occasion ?? 'casual')
  const [ids, setIds] = useState<string[]>(initial?.garmentIds ?? [])
  const [name, setName] = useState(initial?.name ?? '')
  const [picking, setPicking] = useState<Picking | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byId = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments])
  const items = ids.map((id) => byId.get(id)).filter((g): g is Garment => !!g)
  const ctx: EditContext = useMemo(
    () => ({ occasion, weather: null, garments, wears, today }),
    [occasion, garments, wears, today],
  )
  const slot = (c: Category) => items.filter((g) => g.category === c)
  const complete = REQUIRED.every((r) => slot(r.category).length === 1)
  const hardIssue = structureIssues(items, { needsOuterwear: false, complete: false })
  const breaksRules = complete && !validateManualOutfit(ids, { occasion, weather: null, garments }).ok

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave({ garmentIds: ids, occasion, name: name.trim() })
    } catch {
      setError('No se pudo guardar el outfit.')
      setBusy(false)
    }
  }

  if (picking) {
    const replace = picking.replaceId ? (byId.get(picking.replaceId) ?? null) : null
    const label = CATEGORY_LABELS[picking.category]
    return (
      <BottomSheet title={replace ? `Cambiar ${garmentName(replace)}` : `Elegir ${label.toLowerCase()}`} onClose={() => setPicking(null)}>
        <SlotPicker
          ctx={ctx}
          items={items}
          category={picking.category}
          replace={replace}
          onApply={(next) => {
            setIds(next.map((g) => g.id))
            setPicking(null)
          }}
        />
      </BottomSheet>
    )
  }

  const row = (label: string, category: Category, g: Garment | undefined, optional: boolean) => (
    <li key={`${category}-${g?.id ?? 'empty'}`} className="editor-row">
      <span className="editor-slot">{label}</span>
      <button
        type="button"
        className="btn btn-inline editor-pick"
        onClick={() => setPicking({ category, replaceId: g?.id ?? null })}
        aria-label={g ? `Cambiar ${garmentName(g)}` : `Elegir ${label.toLowerCase()}`}
      >
        {g ? garmentName(g) : 'Elegir'}
      </button>
      {optional && g && (
        <button
          type="button"
          className="icon-btn"
          aria-label={`Quitar ${garmentName(g)}`}
          onClick={() => setIds((cur) => cur.filter((id) => id !== g.id))}
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </li>
  )

  const accessories = slot('accessory')
  return (
    <BottomSheet title={title} onClose={onClose}>
      <div className="chips" role="group" aria-label="Ocasión del outfit">
        {OCCASIONS.map((o) => (
          <button
            key={o}
            type="button"
            className={`chip${o === occasion ? ' chip-active' : ''}`}
            aria-pressed={o === occasion}
            onClick={() => setOccasion(o)}
          >
            {OCCASION_LABELS[o]}
          </button>
        ))}
      </div>
      {items.length > 0 && (
        <OutfitVisual items={items} size="small" onSelectGarment={(id) => setPicking({ category: byId.get(id)!.category, replaceId: id })} />
      )}
      <ul className="editor-rows" aria-label="Piezas del outfit">
        {REQUIRED.map((r) => row(r.label, r.category, slot(r.category)[0], false))}
        {slot('outerwear').length > 0 ? row('Capa exterior', 'outerwear', slot('outerwear')[0], true) : null}
        {accessories.map((a) => row('Accesorio', 'accessory', a, true))}
      </ul>
      <div className="editor-add">
        {slot('outerwear').length === 0 && (
          <button type="button" className="btn btn-inline" onClick={() => setPicking({ category: 'outerwear', replaceId: null })}>
            <Plus size={16} aria-hidden="true" />
            Capa exterior
          </button>
        )}
        {accessories.length < 2 && (
          <button type="button" className="btn btn-inline" onClick={() => setPicking({ category: 'accessory', replaceId: null })}>
            <Plus size={16} aria-hidden="true" />
            Accesorio
          </button>
        )}
      </div>
      <label className="field">
        <span>Nombre (opcional)</span>
        <input value={name} maxLength={60} placeholder="Ej. Viernes en la oficina" onChange={(e) => setName(e.target.value)} />
      </label>
      {!complete && <p className="page-hint">Elige una prenda superior, una inferior y calzado para poder guardarlo.</p>}
      {(breaksRules || hardIssue.length > 0) && (
        <p className="warning" role="status">
          Este outfit rompe alguna regla de ocasión o formalidad, pero puedes guardarlo.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="sheet-actions sheet-gap">
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !complete} onClick={() => void save()}>
          {saveLabel}
        </button>
      </div>
    </BottomSheet>
  )
}
