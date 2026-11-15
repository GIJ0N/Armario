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

/**
 * Maniquí neutro de frente, tipo croquis de moda masculino (sin rostro): hombros redondeados que caen desde el cuello,
 * torso que se afina hacia la cintura, brazos relajados algo separados del cuerpo con manos, piernas con rodillas y
 * pies abiertos hacia afuera. Se dibuja el lado izquierdo y se refleja; los rellenos usan tokens.
 * Anatomía (unidades): cuello ≈ 98, axilas ≈ 150, cintura ≈ 256, cadera ≈ 290, rodillas ≈ 424, tobillos ≈ 536.
 */
function Mannequin() {
  const half = (
    <>
      {/* brazo: deltoides redondo, codo suave, antebrazo que se afina hacia la muñeca y mano con pulgar */}
      <path d="M99 116 C88 118 82 130 80 146 C77 170 76 192 72 214 C69 232 66 252 64 276 C63 288 62 296 61 304 C57 318 55 330 57 342 C58 352 67 358 73 350 C76 345 77 339 78 334 C80 330 84 329 85 320 C86 312 85 308 85 304 C87 292 89 278 92 262 C96 244 100 228 103 210 C106 192 108 172 109 156 C107 140 106 124 99 116 Z" />
      {/* pierna: muslo que se afina a la rodilla, pantorrilla, tobillo fino */}
      <path d="M160 270 L119 270 C113 300 109 346 113 380 C115 402 118 414 119 428 C120 446 116 462 117 482 C118 502 124 520 127 538 L150 538 C151 520 152 502 153 484 C154 462 153 444 154 428 C156 400 158 360 160 300 Z" />
      {/* pie abierto hacia afuera */}
      <path d="M126 534 L151 534 C152 548 151 560 148 572 C144 586 126 596 108 590 C99 587 99 580 107 574 C117 568 122 556 126 534 Z" />
    </>
  )
  return (
    <svg className="mannequin" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} aria-hidden="true" focusable="false">
      <ellipse className="mannequin-ground" cx="160" cy="594" rx="86" ry="5" />
      <g className="mannequin-body">
        <path d="M160 14 C176 14 184 30 183 46 C182 62 174 74 160 75 C146 74 138 62 137 46 C136 30 144 14 160 14 Z" />
        {/* cuello y trapecios hasta el pecho */}
        <path d="M150 62 C148 82 146 94 138 100 C126 104 110 106 100 114 C96 118 94 126 95 138 C100 152 104 158 106 168 C107 200 113 232 120 256 C121 272 117 284 114 298 L206 298 C203 284 199 272 200 256 C207 232 213 200 214 168 C216 158 220 152 225 138 C226 126 224 118 220 114 C210 106 194 104 182 100 C174 94 172 82 170 62 Z" />
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
