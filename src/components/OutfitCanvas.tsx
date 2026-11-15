import { Footprints, RectangleVertical, Shirt, Watch } from 'lucide-react'
import { CATEGORY_LABELS, type Category, type Garment } from '../db'
import { CANVAS_H, CANVAS_W, layoutOutfit, type LayoutInput } from '../canvas/layout'
import { useGarmentImages } from './useGarmentImage'

const ICONS: Record<Category, typeof Shirt> = {
  top: Shirt,
  outerwear: Shirt,
  bottom: RectangleVertical,
  shoes: Footprints,
  accessory: Watch,
}

const garmentName = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

/** Maniquí neutro de frente (sin rostro): solo formas con tokens, a la izquierda y espejo a la derecha. */
function Mannequin() {
  const half = (
    <>
      <path d="M100 114 C88 116 80 126 78 142 L72 215 L68 262 L66 300 C66 312 72 322 78 320 C86 320 88 310 88 300 L92 262 L100 215 L106 160 Z" />
      <path d="M106 268 L158 268 L158 330 L155 400 L152 470 L151 548 L121 548 L121 470 L118 400 L108 330 Z" />
      <path d="M120 546 L152 546 L156 574 C156 586 146 592 132 592 C118 592 108 586 110 578 Z" />
    </>
  )
  return (
    <svg className="mannequin" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} aria-hidden="true" focusable="false">
      <ellipse className="mannequin-ground" cx="160" cy="592" rx="82" ry="6" />
      <g className="mannequin-body">
        <ellipse cx="160" cy="52" rx="23" ry="29" />
        <path d="M148 80 L172 80 L174 106 L146 106 Z" />
        <path d="M130 102 C116 104 104 108 98 120 L92 150 L98 215 L104 262 L112 282 L208 282 L216 262 L222 215 L228 150 L222 120 C216 108 204 104 190 102 Z" />
        {half}
        <g transform={`translate(${CANVAS_W} 0) scale(-1 1)`}>{half}</g>
      </g>
    </svg>
  )
}

interface Props {
  items: Garment[]
  size?: 'large' | 'small'
  /** Se llama al tocar una prenda sobre el lienzo o su etiqueta (la fase 12 abre el editor). */
  onSelectGarment?: (id: string) => void
  /** Prenda candidata: su etiqueta lleva «(nueva)». */
  newId?: string
}

/** Outfit sobre un maniquí: recortes sin fondo colocados donde se llevan puestos. Determinista y sin red. */
export function OutfitCanvas({ items, size = 'large', onSelectGarment, newId }: Props) {
  const sources = items.map((g) => {
    const mask = g.cutout_kind === 'mask' && !!g.cutout_path
    return { key: mask ? g.cutout_path! : (g.cutout_path ?? g.photo_path ?? null), mask }
  })
  const images = useGarmentImages(sources.map((s) => s.key))

  const inputs: LayoutInput[] = items.map((g, i) => {
    const img = sources[i].key ? images.get(sources[i].key!) : undefined
    return {
      id: g.id,
      category: g.category,
      subcategory: g.subcategory,
      aspect: img?.width && img.height ? img.width / img.height : null,
      framed: !(sources[i].mask && img),
    }
  })
  const boxes = layoutOutfit(inputs)
  const byId = new Map(items.map((g, i) => [g.id, { g, i }]))

  return (
    <div className="outfit-canvas" data-size={size} data-testid="outfit-visual">
      <div className="canvas-panel">
        <div className="canvas-stage" style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}>
          <Mannequin />
          {boxes.map((b) => {
            const { g, i } = byId.get(b.id)!
            const img = sources[i].key ? images.get(sources[i].key!) : undefined
            const Icon = ICONS[g.category]
            return (
              <button
                key={g.id}
                type="button"
                className="canvas-garment"
                data-zone={b.zone}
                aria-label={garmentName(g)}
                onClick={() => onSelectGarment?.(g.id)}
                style={{
                  left: `${(b.x / CANVAS_W) * 100}%`,
                  top: `${(b.y / CANVAS_H) * 100}%`,
                  width: `${(b.w / CANVAS_W) * 100}%`,
                  height: `${(b.h / CANVAS_H) * 100}%`,
                  zIndex: b.z + 1,
                }}
              >
                {!b.framed && img ? (
                  <img className="canvas-cutout" src={img.url} alt="" draggable={false} />
                ) : (
                  <span className="canvas-tile" data-testid="canvas-tile">
                    {img ? <img src={img.url} alt="" draggable={false} /> : <Icon strokeWidth={1.4} aria-hidden="true" />}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      <ul className="canvas-chips" aria-label="Prendas del outfit">
        {items.map((g) => (
          <li key={g.id}>
            <button type="button" className="chip chip-small" onClick={() => onSelectGarment?.(g.id)}>
              {garmentName(g)}
              {g.id === newId ? ' (nueva)' : ''}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
