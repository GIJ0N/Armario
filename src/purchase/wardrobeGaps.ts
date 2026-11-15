import type { Category, Garment } from '../db/types'
import { activeWardrobe, describeComplement, hypotheticalGarment, pickNeutralColor, slotName, type ComplementDescriptor } from './common'
import { simulateWithGarment } from './simulate'

export const WARDROBE_GAP_COUNT = 3
type Slot = Exclude<Category, 'accessory'>
const SLOTS: Slot[] = ['top', 'bottom', 'shoes', 'outerwear']
const WARMTH_OPTIONS: Record<Slot, number[]> = { top: [2, 3], bottom: [2, 3], shoes: [2], outerwear: [3, 4] }

export interface WardrobeGapSuggestion {
  descriptor: ComplementDescriptor
  /** «Zapato de vestir negro, formalidad 4». */
  label: string
  /** Outfits NUEVOS (ocasiones × climas, distintos) que desbloquearía; calculado por el motor. */
  unlocks: number
  /** Frase en español de la IA (opcional); los números nunca vienen de ella. */
  phrase?: string
}

/**
 * «Qué le falta a mi armario»: sin candidata, prueba prendas hipotéticas (espacio × formalidad 1-5 ×
 * abrigo 2-3, o 3-4 en capa exterior; corte regular) y cuenta cuántos outfits NUEVOS válidos desbloquea cada una
 * en todas las ocasiones y climas. Como el motor trata igual a todos los neutros, el recuento no cambia con el
 * color: se simula una vez por combinación y después se elige el neutro menos presente en el armario.
 * Devuelve las 3 mejores, sin repetir espacio + formalidad.
 */
export function computeWardrobeGaps(wardrobe: Garment[]): WardrobeGapSuggestion[] {
  const active = activeWardrobe(wardrobe)
  const scored: WardrobeGapSuggestion[] = []
  for (const slot of SLOTS) {
    const color = pickNeutralColor(slot, active)
    for (let formality = 1; formality <= 5; formality++) {
      let best: WardrobeGapSuggestion | null = null
      for (const warmth of WARMTH_OPTIONS[slot]) {
        const descriptor: ComplementDescriptor = {
          category: slot,
          subcategory: slotName(slot, formality).text,
          colors: [color],
          formality,
          warmth,
          fit: 'regular',
        }
        const sim = simulateWithGarment(hypotheticalGarment(descriptor), { garments: active }, { examples: false })
        if (!best || sim.total > best.unlocks) best = { descriptor, label: describeComplement(descriptor, true), unlocks: sim.total }
      }
      if (best && best.unlocks > 0) scored.push(best)
    }
  }
  // Ya hay un solo representante por espacio + formalidad (se queda el abrigo que más desbloquea).
  return scored
    .sort((a, b) => b.unlocks - a.unlocks || a.descriptor.formality - b.descriptor.formality || SLOTS.indexOf(a.descriptor.category as Slot) - SLOTS.indexOf(b.descriptor.category as Slot))
    .slice(0, WARDROBE_GAP_COUNT)
}
