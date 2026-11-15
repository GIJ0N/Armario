import type { Category, Garment, StoredComplement } from '../db/types'
import {
  activeWardrobe,
  describeComplement,
  hypotheticalGarment,
  pickNeutralColor,
  primaryColor,
  slotName,
  type ComplementDescriptor,
} from './common'
import { simulateWithGarment, type SimulationResult } from './simulate'

export const MAX_COMPLEMENTS = 3

/** Outfits ADICIONALES con la candidata al sumar la prenda hipotética `descriptor` al armario (calculado por el motor). */
export function unlockedByComplement(
  candidate: Garment,
  wardrobe: Garment[],
  base: SimulationResult,
  descriptor: ComplementDescriptor,
): number {
  const hyp = hypotheticalGarment(descriptor)
  const after = simulateWithGarment(candidate, { garments: [...wardrobe, hyp] }, { examples: false })
  return after.total - base.total
}

const SLOTS: Exclude<Category, 'accessory'>[] = ['top', 'bottom', 'shoes', 'outerwear']
const WARMTH_OPTIONS: Record<Exclude<Category, 'accessory'>, number[]> = {
  top: [2, 3],
  bottom: [2, 3],
  shoes: [2],
  outerwear: [3, 4],
}

/** Complemento con sus números ya calculados; `reason` solo lo trae la IA. */
export function toStoredComplement(
  d: ComplementDescriptor,
  unlocks: number,
  source: 'rules' | 'ai',
  reason?: string,
): StoredComplement {
  return {
    category: d.category,
    subcategory: d.subcategory,
    colors: d.colors,
    formality: d.formality,
    warmth: d.warmth,
    fit: d.fit,
    ...(d.material ? { material: d.material } : {}),
    ...(d.pattern ? { pattern: d.pattern } : {}),
    label: describeComplement(d, source === 'rules'),
    ...(reason ? { reason } : {}),
    unlocks,
    source,
  }
}

/**
 * Hasta 3 complementos deterministas: la prenda del espacio que falta, con formalidad de la candidata (±1),
 * neutra, corte regular y abrigo acorde. Cada uno se simula agregado al armario; se ordenan por los outfits
 * adicionales que desbloquean con la candidata (solo se devuelven los que desbloquean más de 0).
 */
export function suggestComplements(
  candidate: Garment,
  wardrobe: Garment[],
  base: SimulationResult = simulateWithGarment(candidate, { garments: wardrobe }, { examples: false }),
): StoredComplement[] {
  const active = activeWardrobe(wardrobe, candidate.id)
  const slots = SLOTS.filter((s) => s !== candidate.category)
  const scored: { d: ComplementDescriptor; unlocks: number; dist: number; order: number }[] = []
  let order = 0
  for (const slot of slots) {
    const color = pickNeutralColor(slot, active, primaryColor(candidate))
    const best = new Map<number, { d: ComplementDescriptor; unlocks: number }>()
    for (const formality of [candidate.formality, candidate.formality - 1, candidate.formality + 1]) {
      if (formality < 1 || formality > 5) continue
      for (const warmth of WARMTH_OPTIONS[slot]) {
        const d: ComplementDescriptor = {
          category: slot,
          subcategory: slotName(slot, formality).text,
          colors: [color],
          formality,
          warmth,
          fit: 'regular',
        }
        const unlocks = unlockedByComplement(candidate, active, base, d)
        const prev = best.get(formality)
        if (!prev || unlocks > prev.unlocks) best.set(formality, { d, unlocks })
      }
    }
    for (const [formality, { d, unlocks }] of best) {
      scored.push({ d, unlocks, dist: Math.abs(formality - candidate.formality), order: order++ })
    }
  }
  return scored
    .filter((s) => s.unlocks > 0)
    .sort((a, b) => b.unlocks - a.unlocks || a.dist - b.dist || a.order - b.order)
    .slice(0, MAX_COMPLEMENTS)
    .map((s) => toStoredComplement(s.d, s.unlocks, 'rules'))
}
