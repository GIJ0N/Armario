import { CATEGORY_LABELS, OCCASION_LABELS } from '../db/labels'
import { OCCASIONS, type Category, type Garment } from '../db/types'
import { formalityRange } from '../engine/occasions'
import { activeWardrobe, isNeutralColor, primaryColor } from './common'
import { simulateWithGarment, type SimulationResult } from './simulate'
import type { WeatherPresetKey } from '../weather/presets'

export type GapKind = 'missing_slot' | 'thin_slot' | 'no_pairing' | 'statement' | 'color' | 'weather' | 'occasion'

export interface Gap {
  kind: GapKind
  slot?: Category
  /** Mensaje en español. */
  message: string
}

const SLOT_NOUN: Record<'top' | 'bottom' | 'shoes', { plural: string; one: string }> = {
  top: { plural: 'prendas superiores', one: 'una prenda superior' },
  bottom: { plural: 'pantalones o inferiores', one: 'un pantalón o inferior' },
  shoes: { plural: 'zapatos', one: 'un par de zapatos' },
}

const WEATHER_NAME: Partial<Record<WeatherPresetKey, string>> = { hot: 'calor', cold: 'frío', warm: 'clima templado' }

/**
 * Detección de huecos por reglas (sin IA): por espacio, explica por qué no salen outfits con la candidata
 * (calzado o inferior sin formalidad compatible, protagonistas, clima, ocasiones y color).
 */
export function analyzeGaps(
  candidate: Garment,
  wardrobe: Garment[],
  sim: SimulationResult = simulateWithGarment(candidate, { garments: wardrobe }, { examples: false }),
): Gap[] {
  const active = activeWardrobe(wardrobe, candidate.id)
  const cf = candidate.formality
  const lo = Math.max(1, cf - 1)
  const hi = Math.min(5, cf + 1)
  const gaps: Gap[] = []
  const partnerSlots = (['top', 'bottom', 'shoes'] as const).filter((s) => s !== candidate.category)
  const near: Partial<Record<(typeof partnerSlots)[number], Garment[]>> = {}

  for (const slot of partnerSlots) {
    const inSlot = active.filter((g) => g.category === slot)
    const close = inSlot.filter((g) => Math.abs(g.formality - cf) <= 1)
    near[slot] = close
    if (inSlot.length === 0) {
      gaps.push({ kind: 'missing_slot', slot, message: `No tienes ${SLOT_NOUN[slot].plural} en tu armario.` })
    } else if (close.length === 0) {
      gaps.push({
        kind: 'missing_slot',
        slot,
        message: `No tienes ${SLOT_NOUN[slot].plural} con formalidad ${lo === hi ? lo : `${lo}–${hi}`} para combinar con esta prenda (formalidad ${cf}).`,
      })
    } else if (close.length === 1 && close[0].category !== candidate.category) {
      gaps.push({
        kind: 'thin_slot',
        slot,
        message: `Solo tienes ${SLOT_NOUN[slot].one} con formalidad ${lo === hi ? lo : `${lo}–${hi}`} para combinar con esta prenda: casi no hay combinaciones.`,
      })
    } else if (candidate.is_statement && close.every((g) => g.is_statement)) {
      gaps.push({
        kind: 'statement',
        slot,
        message: `Esta prenda es llamativa y tus ${SLOT_NOUN[slot].plural} compatibles también: solo puede haber una prenda protagonista por outfit.`,
      })
    }
  }

  const hasMissing = gaps.some((g) => g.kind === 'missing_slot')

  // Cada espacio tiene opciones cercanas, pero ninguna terna cumple la dispersión de formalidad ≤ 1.
  if (!hasMissing && sim.total === 0 && candidate.category !== 'outerwear' && candidate.category !== 'accessory') {
    const [a, b] = partnerSlots
    const works = near[a]!.some((x) => near[b]!.some((y) => Math.max(cf, x.formality, y.formality) - Math.min(cf, x.formality, y.formality) <= 1))
    if (!works) {
      gaps.push({
        kind: 'no_pairing',
        message: `Tus ${SLOT_NOUN[a].plural} y ${SLOT_NOUN[b].plural} compatibles no combinan entre sí con esta prenda (formalidad muy distinta).`,
      })
    }
  }

  // Color: la candidata no es neutra y no hay neutros compatibles en un espacio.
  const color = candidate.colors[0]
  if (color && !isNeutralColor(color)) {
    for (const slot of partnerSlots) {
      const close = near[slot] ?? []
      if (close.length > 0 && close.every((g) => g.colors[0] && !isNeutralColor(g.colors[0]) && primaryColor(g) !== primaryColor(candidate))) {
        gaps.push({
          kind: 'color',
          slot,
          message: `Su color (${color}) no es neutro y tus ${SLOT_NOUN[slot].plural} compatibles tampoco: se vería recargado.`,
        })
      }
    }
  }

  // Clima: no forma ningún outfit con calor/frío/templado.
  if (!hasMissing) {
    for (const w of ['hot', 'cold', 'warm'] as const) {
      if (sim.perWeather[w] > 0 || (sim.total === 0 && candidate.category === 'accessory')) continue
      const name = WEATHER_NAME[w]!
      let why = ''
      if (w === 'hot' && candidate.warmth >= 3 && candidate.category !== 'shoes') why = ` (abrigo ${candidate.warmth}, demasiado abrigadora)`
      if (w === 'cold' && candidate.warmth <= 1 && candidate.category !== 'shoes') why = ` (abrigo ${candidate.warmth}, demasiado ligera)`
      if (w === 'cold' && !why && !active.some((g) => g.category === 'outerwear') && candidate.category !== 'outerwear') {
        why = ': con frío hace falta una capa exterior y no tienes'
      }
      gaps.push({ kind: 'weather', message: `No forma outfits con ${name}${why}.` })
    }
  }

  // Ocasiones sin outfits: por formalidad fuera de rango o por falta de combinaciones.
  const outOfRange: string[] = []
  const noCombos: string[] = []
  for (const o of OCCASIONS) {
    if (sim.perOccasion[o] > 0) continue
    const [a, b] = formalityRange(o, candidate.category)
    if ((cf < a || cf > b) && !candidate.occasions.includes(o)) outOfRange.push(OCCASION_LABELS[o])
    else noCombos.push(OCCASION_LABELS[o])
  }
  if (sim.total > 0 && outOfRange.length > 0) {
    gaps.push({ kind: 'occasion', message: `Por su formalidad (${cf}) no encaja en: ${outOfRange.join(', ')}.` })
  }
  if (noCombos.length > 0 && !hasMissing) {
    gaps.push({ kind: 'occasion', message: `Con tu armario actual no alcanza para: ${noCombos.join(', ')}.` })
  }
  if (sim.total === 0 && !hasMissing && gaps.length === 0) {
    gaps.push({ kind: 'no_pairing', message: `No forma ningún outfit válido con tu armario (${CATEGORY_LABELS[candidate.category].toLowerCase()}, formalidad ${cf}).` })
  }
  return gaps
}
