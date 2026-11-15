import { CATEGORY_LABELS, type Garment } from '../db'
import { GarmentPhoto } from './GarmentPhoto'

/** Área visual de un outfit. Aislada para que la fase 11 la sustituya por el maniquí. */
export function OutfitVisual({ items }: { items: Garment[] }) {
  return (
    <ul className="outfit-visual" data-count={Math.min(items.length, 6)} data-testid="outfit-visual">
      {items.map((g) => {
        const title = g.subcategory || CATEGORY_LABELS[g.category]
        return (
          <li key={g.id} className="outfit-item">
            <div className="outfit-thumb">
              <GarmentPhoto photoPath={g.photo_path} alt={title} />
            </div>
            <span className="outfit-item-name">{title}</span>
          </li>
        )
      })}
    </ul>
  )
}
