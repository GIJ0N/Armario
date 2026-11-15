import { CATEGORY_LABELS } from '../db/labels'
import type { Category, Fit, Garment } from '../db/types'
import { NEUTRAL_COLORS } from '../engine/fallback'

/** Minúsculas, sin acentos, sin espacios sobrantes. */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export const primaryColor = (g: Pick<Garment, 'colors'>): string => norm(g.colors[0] ?? '')

/** Prendas activas (las candidatas, retiradas y en lavandería no cuentan), sin la prenda `excludeId`. */
export function activeWardrobe(garments: Garment[], excludeId?: string): Garment[] {
  return garments.filter((g) => g.status === 'active' && g.id !== excludeId)
}

/** Prenda hipotética descrita solo por atributos (un complemento posible). */
export interface ComplementDescriptor {
  category: Category
  subcategory: string
  colors: string[]
  formality: number
  warmth: number
  fit: Fit
  material?: string
  pattern?: string
}

let hypCounter = 0

export function hypotheticalGarment(d: ComplementDescriptor, id = `hyp-${++hypCounter}`): Garment {
  return {
    id,
    photo_path: null,
    category: d.category,
    subcategory: d.subcategory,
    colors: d.colors,
    pattern: d.pattern ?? 'liso',
    material: d.material ?? '',
    fit: d.fit,
    formality: d.formality,
    warmth: d.warmth,
    occasions: [],
    is_statement: false,
    status: 'active',
    notes: '',
    created_at: '2100-01-01T00:00:00.000Z',
  }
}

export const NEUTRAL_PREFERENCE = ['negro', 'azul marino', 'gris', 'blanco', 'beige', 'café'] as const
/** Neutros razonables por espacio (en orden de preferencia). */
const NEUTRALS_BY_SLOT: Record<Category, readonly string[]> = {
  top: NEUTRAL_PREFERENCE,
  bottom: ['negro', 'azul marino', 'gris', 'beige', 'café'],
  shoes: ['negro', 'café'],
  outerwear: ['negro', 'azul marino', 'gris', 'beige'],
  accessory: NEUTRAL_PREFERENCE,
}

/** Neutro menos presente entre las prendas del mismo espacio (desempate: orden de NEUTRAL_PREFERENCE). */
export function pickNeutralColor(category: Category, wardrobe: Garment[], avoid?: string): string {
  const inSlot = wardrobe.filter((g) => g.category === category)
  const palette = NEUTRALS_BY_SLOT[category]
  let best: string = palette[0]
  let bestCount = Infinity
  for (const c of palette) {
    if (avoid && norm(c) === avoid) continue
    const n = inSlot.filter((g) => primaryColor(g) === norm(c)).length
    if (n < bestCount) {
      best = c
      bestCount = n
    }
  }
  return best
}

export function isNeutralColor(color: string): boolean {
  const c = norm(color)
  return NEUTRAL_COLORS.some((n) => c === norm(n) || c.startsWith(`${norm(n)} `))
}

type Gender = 'm' | 'f'

/** Nombre y género por espacio y formalidad (1-5) para describir complementos en español. */
export const SLOT_NAMES: Record<Exclude<Category, 'accessory'>, [string, Gender][]> = {
  top: [['playera deportiva', 'f'], ['playera', 'f'], ['polo', 'm'], ['camisa de vestir', 'f'], ['camisa de vestir', 'f']],
  bottom: [['short deportivo', 'm'], ['pantalón casual', 'm'], ['pantalón chino', 'm'], ['pantalón de vestir', 'm'], ['pantalón de vestir', 'm']],
  shoes: [['zapatilla deportiva', 'f'], ['zapato casual', 'm'], ['mocasín', 'm'], ['zapato de vestir', 'm'], ['zapato de vestir', 'm']],
  outerwear: [['chamarra ligera', 'f'], ['chamarra', 'f'], ['chamarra', 'f'], ['blazer', 'm'], ['saco', 'm']],
}

export function slotName(category: Category, formality: number): { text: string; gender: Gender } {
  if (category === 'accessory') return { text: 'accesorio', gender: 'm' }
  const [text, gender] = SLOT_NAMES[category][Math.min(5, Math.max(1, formality)) - 1]
  return { text, gender }
}

function agree(color: string, gender: Gender): string {
  if (gender === 'f') return color.replace(/\bnegro\b/, 'negra').replace(/\bblanco\b/, 'blanca')
  return color
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** «Zapato de vestir negro, formalidad 4». */
export function describeComplement(d: ComplementDescriptor, rule = false): string {
  const { text, gender } = rule ? slotName(d.category, d.formality) : { text: d.subcategory.trim() || CATEGORY_LABELS[d.category].toLowerCase(), gender: 'm' as Gender }
  const color = d.colors[0] ? ` ${rule ? agree(d.colors[0], gender) : d.colors[0]}` : ''
  return `${capitalize(text)}${color}, formalidad ${d.formality}`
}
