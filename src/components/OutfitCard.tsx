import { CATEGORY_LABELS, type Garment } from '../db'
import type { SuggestedOutfit } from '../engine'
import { GarmentPhoto } from './GarmentPhoto'

const SOURCE_LABELS = { ia: 'IA', reglas: 'reglas' } as const

interface OutfitCardProps {
  outfit: SuggestedOutfit
  garments: Map<string, Garment>
  /** Si se omite, la tarjeta no muestra «Me lo pongo». */
  onWear?: () => void
  onUndo?: () => void
  worn?: boolean
  busy?: boolean
}

export function OutfitCard({ outfit, garments, onWear, onUndo, worn = false, busy = false }: OutfitCardProps) {
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
      {/* Fase 5: aquí irán también me gusta / no me gusta. */}
      <div className="outfit-actions">
        {onWear &&
          (worn ? (
            <>
              <span className="worn-note" data-testid="worn-note">
                Puesto hoy ✓
              </span>
              <button type="button" className="btn btn-quiet btn-inline" disabled={busy} onClick={onUndo}>
                Deshacer
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={onWear}>
              Me lo pongo
            </button>
          ))}
      </div>
    </li>
  )
}
