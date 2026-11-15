import { canRenderCanvas } from '../canvas/layout'
import type { AdjustChange, OutfitLayout } from '../canvas/adjust'
import { CATEGORY_LABELS, type Garment } from '../db'
import { GarmentPhoto } from './GarmentPhoto'
import { OutfitCanvas } from './OutfitCanvas'

interface Props {
  items: Garment[]
  size?: 'large' | 'small'
  onSelectGarment?: (id: string) => void
  newId?: string
  layout?: OutfitLayout | null
  onAdjustSave?: (change: AdjustChange) => void | Promise<void>
  onAdjustRequest?: () => void
  onAdjustingChange?: (adjusting: boolean) => void
  shareable?: boolean
}

/**
 * Punto de entrada del área visual de un outfit: lienzo con maniquí si hay prenda de arriba o de abajo;
 * si no (datos raros), la cuadrícula de miniaturas anterior.
 */
export function OutfitVisual({ items, size = 'large', onSelectGarment, newId, ...adjust }: Props) {
  if (canRenderCanvas(items)) {
    return <OutfitCanvas items={items} size={size} onSelectGarment={onSelectGarment} newId={newId} {...adjust} />
  }
  return (
    <ul className="outfit-visual" data-count={Math.min(items.length, 6)} data-testid="outfit-visual-grid">
      {items.map((g) => {
        const title = g.subcategory || CATEGORY_LABELS[g.category]
        return (
          <li key={g.id} className="outfit-item">
            <div className="outfit-thumb">
              <GarmentPhoto photoPath={g.photo_path} cutoutPath={g.cutout_path} alt={title} />
            </div>
            <span className="outfit-item-name">{title}</span>
          </li>
        )
      })}
    </ul>
  )
}
