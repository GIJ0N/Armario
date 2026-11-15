import { useMemo, useState } from 'react'
import { CATEGORY_LABELS, type Category, type Garment, type Occasion } from '../db'
import {
  canRemoveCategory,
  findAlternatives,
  shuffleAlternative,
  type Weather,
  type WearRecord,
} from '../engine'
import { AlternativesPicker } from './AlternativesPicker'
import { BottomSheet } from './BottomSheet'
import { useToast } from './ToastProvider'

export interface EditContext {
  occasion: Occasion
  /** null = sin clima. */
  weather: Weather | null
  /** Activas y en lavandería. */
  garments: Garment[]
  wears: WearRecord[]
  today: string
}

export type EditTarget = { kind: 'swap'; garmentId: string } | { kind: 'add' }

interface Props {
  ctx: EditContext
  /** Prendas actuales del outfit. */
  items: Garment[]
  target: EditTarget
  /** Recibe las nuevas prendas del outfit (ya con el cambio aplicado). */
  onApply: (next: Garment[], summary: string) => void
  onClose: () => void
}

const name = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

/** Elige una pieza para `category` (cambiando `replace` o agregando) y devuelve el nuevo conjunto de prendas. */
export function SlotPicker({
  ctx,
  items,
  category,
  replace,
  onApply,
}: {
  ctx: EditContext
  items: Garment[]
  category: Category
  replace: Garment | null
  onApply: (next: Garment[], summary: string) => void
}) {
  const toast = useToast()
  const alternatives = useMemo(
    () => findAlternatives({ ...ctx, items, replaceId: replace?.id ?? null, category }),
    [ctx, items, replace, category],
  )
  const without = items.filter((g) => g.id !== replace?.id)
  const pick = (g: Garment) => {
    // Elegir de «Otras» sigue permitido, pero se avisa el motivo.
    const unfit = alternatives.others.find((o) => o.garment.id === g.id)
    if (unfit) toast(`Ojo: ${unfit.reason}`)
    onApply(
      replace ? items.map((x) => (x.id === replace.id ? g : x)) : [...items, g],
      replace ? `Cambiaste ${name(replace)} por ${name(g)}` : `Agregaste ${name(g)}`,
    )
  }
  const removable = !!replace && canRemoveCategory(category, ctx)
  return (
    <AlternativesPicker
      alternatives={alternatives}
      onPick={pick}
      onShuffle={() => {
        const g = shuffleAlternative(alternatives)
        if (g) pick(g)
      }}
      onRemove={removable ? () => onApply(without, `Quitaste ${name(replace!)}`) : undefined}
    />
  )
}

const ADDABLE: { category: Category; label: string }[] = [
  { category: 'outerwear', label: 'Capa exterior' },
  { category: 'accessory', label: 'Accesorio' },
]

/** Hoja «Cambiar <prenda>» o «Añadir pieza» para un outfit sugerido. */
export function OutfitEditFlow({ ctx, items, target, onApply, onClose }: Props) {
  const [addCategory, setAddCategory] = useState<Category | null>(null)
  const replace = target.kind === 'swap' ? (items.find((g) => g.id === target.garmentId) ?? null) : null

  if (target.kind === 'swap' && !replace) return null
  if (target.kind === 'swap') {
    return (
      <BottomSheet title={`Cambiar ${name(replace!)}`} onClose={onClose}>
        <SlotPicker ctx={ctx} items={items} category={replace!.category} replace={replace} onApply={onApply} />
      </BottomSheet>
    )
  }
  if (!addCategory) {
    const hasOuter = items.some((g) => g.category === 'outerwear')
    const accessories = items.filter((g) => g.category === 'accessory').length
    return (
      <BottomSheet title="Añadir pieza" onClose={onClose}>
        <p className="page-hint">¿Qué quieres sumar al outfit?</p>
        <div className="sheet-actions sheet-actions-column">
          {ADDABLE.map(({ category, label }) => {
            const blocked =
              category === 'outerwear' ? (hasOuter ? 'Ya hay una capa exterior' : null) : accessories >= 2 ? 'Ya hay 2 accesorios' : null
            return (
              <button key={category} type="button" className="btn" disabled={!!blocked} onClick={() => setAddCategory(category)}>
                {label}
                {blocked && <span className="muted"> · {blocked}</span>}
              </button>
            )
          })}
        </div>
      </BottomSheet>
    )
  }
  return (
    <BottomSheet title={addCategory === 'outerwear' ? 'Añadir capa exterior' : 'Añadir accesorio'} onClose={onClose}>
      <SlotPicker ctx={ctx} items={items} category={addCategory} replace={null} onApply={onApply} />
    </BottomSheet>
  )
}
