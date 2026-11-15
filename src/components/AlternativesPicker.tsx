import { Shuffle, Trash2 } from 'lucide-react'
import { CATEGORY_LABELS, type Garment } from '../db'
import type { Alternatives } from '../engine'
import { GarmentPhoto } from './GarmentPhoto'

interface Props {
  alternatives: Alternatives
  onPick: (garment: Garment) => void
  /** «Barajar»: elige una alternativa válida al azar. */
  onShuffle: () => void
  /** «Quitar»: solo se pasa para capa exterior y accesorios. */
  onRemove?: () => void
}

const garmentName = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

function usage(alt: Alternatives, g: Garment): string {
  const info = alt.rotation.get(g.id)
  if (!info || info.wears === 0) return 'Sin usar'
  if (info.daysSinceWorn === 0) return 'Usada hoy'
  return info.daysSinceWorn === 1 ? 'Usada ayer' : `Usada hace ${info.daysSinceWorn} d`
}

function Row({ garment, alt, reason, onPick }: { garment: Garment; alt: Alternatives; reason?: string; onPick: Props['onPick'] }) {
  return (
    <li>
      <button type="button" className="alt-row" data-testid={reason ? 'alt-other' : 'alt-valid'} onClick={() => onPick(garment)}>
        <span className="alt-thumb">
          <GarmentPhoto photoPath={garment.photo_path} cutoutPath={garment.cutout_path} alt="" />
        </span>
        <span className="alt-text">
          <strong>{garmentName(garment)}</strong>
          <span className="muted">{garment.colors.join(', ') || CATEGORY_LABELS[garment.category]}</span>
        </span>
        {reason ? (
          <span className="alt-reason" data-testid="alt-reason">
            {reason}
          </span>
        ) : (
          <span className="alt-usage">{usage(alt, garment)}</span>
        )}
      </button>
    </li>
  )
}

/** Lista de alternativas: primero las válidas (la menos usada primero), luego «Otras» con su motivo. */
export function AlternativesPicker({ alternatives, onPick, onShuffle, onRemove }: Props) {
  const { valid, others } = alternatives
  return (
    <div className="alt-picker">
      <div className="alt-tools">
        <button type="button" className="btn btn-inline" disabled={valid.length === 0} onClick={onShuffle}>
          <Shuffle size={18} aria-hidden="true" />
          Barajar
        </button>
        {onRemove && (
          <button type="button" className="btn btn-inline" onClick={onRemove}>
            <Trash2 size={18} aria-hidden="true" />
            Quitar
          </button>
        )}
      </div>
      {valid.length === 0 && others.length === 0 && <p className="page-hint">No tienes otras prendas de este tipo.</p>}
      {valid.length > 0 && (
        <>
          <h3 className="alt-heading">Para esta ocasión y clima</h3>
          <ul className="alt-list" aria-label="Alternativas válidas">
            {valid.map((g) => (
              <Row key={g.id} garment={g} alt={alternatives} onPick={onPick} />
            ))}
          </ul>
        </>
      )}
      {valid.length === 0 && others.length > 0 && (
        <p className="page-hint">Ninguna otra prenda encaja con la ocasión y el clima.</p>
      )}
      {others.length > 0 && (
        <>
          <h3 className="alt-heading">Otras</h3>
          <ul className="alt-list" aria-label="Otras prendas">
            {others.map((o) => (
              <Row key={o.garment.id} garment={o.garment} alt={alternatives} reason={o.reason} onPick={onPick} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
