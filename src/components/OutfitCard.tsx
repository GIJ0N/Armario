import { CATEGORY_LABELS, type Garment } from '../db'
import type { SuggestedOutfit } from '../engine'
import { GarmentPhoto } from './GarmentPhoto'

const SOURCE_LABELS = { ia: 'IA', reglas: 'reglas' } as const

export function OutfitCard({ outfit, garments }: { outfit: SuggestedOutfit; garments: Map<string, Garment> }) {
  const items = outfit.garmentIds.map((id) => garments.get(id)).filter((g): g is Garment => !!g)
  return (
    <li className="outfit-card" data-testid="outfit-card">
      <div className="outfit-head">
        <span className="badge badge-source" data-testid="source-badge">
          {SOURCE_LABELS[outfit.source]}
        </span>
      </div>
      <ul className="outfit-items">
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
      <p className="outfit-reasoning">{outfit.reasoning}</p>
      {/* Fase 4/5: aquí van «Me lo pongo» y me gusta / no me gusta. */}
      <div className="outfit-actions" />
    </li>
  )
}
