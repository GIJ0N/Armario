import { Shirt } from 'lucide-react'
import { CATEGORY_LABELS, type Category, type Garment } from '../db'
import { useThumb } from './useThumb'

const ORDER: Category[] = ['top', 'bottom', 'shoes', 'outerwear', 'accessory']

const nameOf = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

function Thumb({ g }: { g: Garment }) {
  const url = useThumb(g.cutout_path ?? g.photo_path)
  return (
    <span className="thumb-cell" data-category={g.category}>
      {url ? <img src={url} alt="" draggable={false} /> : <Shirt size={12} strokeWidth={1.6} aria-hidden="true" />}
    </span>
  )
}

/**
 * Miniatura de un outfit para las celdas del calendario: hasta 4 prendas en una rejilla de 2×2 (arriba, abajo, calzado y
 * capa o accesorio). Más legible a este tamaño que el maniquí completo; decorativa (la celda lleva su etiqueta).
 */
export function OutfitThumbs({ items }: { items: Garment[] }) {
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category)).slice(0, 4)
  return (
    <span className="outfit-thumbs" data-count={sorted.length} aria-hidden="true" title={sorted.map(nameOf).join(', ')}>
      {sorted.map((g) => (
        <Thumb key={g.id} g={g} />
      ))}
    </span>
  )
}
