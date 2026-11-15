import { FORMALITY_LABELS, OCCASION_LABELS } from '../db/labels'
import type { Garment } from '../db/types'
import { OCCASION_RULES } from './occasions'
import { forEachBaseCombo, spreadOf, type Plan } from './plan'
import type { OutfitSuggestion } from './types'
import { validateOutfit } from './validate'

/** Colores neutros: no cuentan para el límite de colores. */
export const NEUTRAL_COLORS = ['negro', 'blanco', 'gris', 'beige', 'azul marino', 'café', 'crema']
export const MAX_NON_NEUTRAL_COLORS = 3
/** Prendas por espacio que se exploran (las más urgentes por rotación) para acotar el tiempo. */
export const SLOT_SEARCH_LIMIT = 25

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
const NEUTRALS = NEUTRAL_COLORS.map(norm)

export function isNeutral(color: string): boolean {
  const c = norm(color)
  return NEUTRALS.some((n) => c === n || c.startsWith(`${n} `))
}

export function nonNeutralColors(items: Garment[]): Set<string> {
  const out = new Set<string>()
  for (const g of items) for (const c of g.colors) if (!isNeutral(c)) out.add(norm(c))
  return out
}

interface Candidate {
  items: Garment[]
  score: number
}

const name = (g: Garment) => (g.subcategory || g.category).toLowerCase()

function scoreCombo(plan: Plan, items: Garment[], rankOf: Map<string, number>): number {
  const n = rankOf.size || 1
  const priority = items.filter((g) => plan.priorityIds.has(g.id)).length
  let score = priority * 100
  for (const g of items) score += (1 - (rankOf.get(g.id) ?? n) / n) * 5
  // Coherencia de formalidad: poca dispersión y calzado alineado con el resto.
  score -= spreadOf(items) * 15
  const shoes = items.find((g) => g.category === 'shoes')!
  const mean = items.reduce((s, g) => s + g.formality, 0) / items.length
  score -= Math.abs(shoes.formality - mean) * 5
  // Color: más de 3 tonos no neutros se penaliza con fuerza.
  score -= Math.max(0, nonNeutralColors(items).size - MAX_NON_NEUTRAL_COLORS) * 40
  // Silueta: evitar todo holgado o todo ajustado (no aplica a gym).
  const top = items.find((g) => g.category === 'top')!
  const bottom = items.find((g) => g.category === 'bottom')!
  if (!OCCASION_RULES[plan.ctx.occasion].relaxSilhouette && top.fit === bottom.fit && top.fit !== 'regular') score -= 4
  if (plan.filter.outerwearAdvice === 'recommended' && items.some((g) => g.category === 'outerwear')) score += 6
  return score
}

function pickAccessories(plan: Plan, core: Garment[], rankOf: Map<string, number>): Garment[] {
  const mean = core.reduce((s, g) => s + g.formality, 0) / core.length
  const pool = plan.filter.bySlot.accessory
    .filter((a) => Math.abs(a.formality - mean) <= 1)
    .sort((a, b) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0) || a.id.localeCompare(b.id))
  const chosen: Garment[] = []
  for (const a of pool) {
    if (chosen.length >= 2) break
    const all = [...core, ...chosen]
    if (a.is_statement && all.some((g) => g.is_statement)) continue
    if (chosen.some((c) => norm(c.subcategory) === norm(a.subcategory))) continue
    // El cinturón debe ir del color del calzado.
    const shoes = core.find((g) => g.category === 'shoes')
    if (norm(a.subcategory).startsWith('cinturon') && shoes?.colors[0] && a.colors[0] && norm(a.colors[0]) !== norm(shoes.colors[0])) continue
    if (nonNeutralColors([...all, a]).size > MAX_NON_NEUTRAL_COLORS) continue
    chosen.push(a)
  }
  return chosen
}

function explain(plan: Plan, core: Garment[], acc: Garment[]): string {
  const get = (c: Garment['category']) => core.find((g) => g.category === c)!
  const top = get('top')
  const bottom = get('bottom')
  const shoes = get('shoes')
  const outer = core.find((g) => g.category === 'outerwear')
  const level = FORMALITY_LABELS[Math.round(core.reduce((s, g) => s + g.formality, 0) / core.length) - 1].toLowerCase()
  // Solo se menciona la rotación cuando hay un criterio real (no si todo es prioritario por no haberse usado).
  const selective = [...plan.priorityIds].length < plan.ctx.garments.filter((g) => plan.filter.eligibleIds.has(g.id) && g.category !== 'accessory').length
  const prio = selective ? core.filter((g) => plan.priorityIds.has(g.id)).map(name).slice(0, 2) : []
  let text = `${name(top)} con ${name(bottom)} y ${name(shoes)}${outer ? `, más ${name(outer)}` : ''}: nivel ${level} parejo para ${OCCASION_LABELS[plan.ctx.occasion].toLowerCase()}`
  if (acc.length) text += `, con ${acc.map(name).join(' y ')}`
  if (prio.length) text += `; rescata ${prio.join(' y ')}, de lo que menos usas`
  return `${text}.`
}

/**
 * Compositor determinista sin IA (pasos 1, 2 y 4): busca combinaciones con tope de iteraciones,
 * puntúa (prioritarias, coherencia, color, silueta) y elige hasta `count` outfits distintos y válidos.
 */
export function composeFallback(plan: Plan, count: number, existing: OutfitSuggestion[] = []): OutfitSuggestion[] {
  if (count <= 0 || plan.filter.missing.length > 0 || !plan.hasCombos) return []
  const rankOf = new Map(plan.rotation.order.map((id, i) => [id, i]))
  const byRank = (a: Garment, b: Garment) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0)
  const mustHavePriority = plan.priorityIds.size > 0

  let pool: Candidate[] = []
  forEachBaseCombo(
    plan,
    (items) => {
      if (mustHavePriority && !items.some((g) => plan.priorityIds.has(g.id))) return
      pool.push({ items, score: scoreCombo(plan, items, rankOf) })
      if (pool.length > 4000) pool = pool.sort((a, b) => b.score - a.score).slice(0, 1000)
    },
    SLOT_SEARCH_LIMIT,
    byRank,
  )
  pool.sort((a, b) => b.score - a.score)
  pool = pool.slice(0, 1500)

  const out: OutfitSuggestion[] = []
  const used = new Map<string, number>()
  const batch = [...existing]
  while (out.length < count && pool.length > 0) {
    // Penaliza reutilizar prendas ya elegidas para que los 3 outfits sean variados.
    let bestIdx = -1
    let best = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]
      const adj = c.score - c.items.reduce((s, g) => s + (used.get(g.id) ?? 0), 0) * 12
      if (adj > best) {
        best = adj
        bestIdx = i
      }
    }
    const [cand] = pool.splice(bestIdx, 1)
    const acc = pickAccessories(plan, cand.items, rankOf)
    const suggestion: OutfitSuggestion = {
      garmentIds: [...cand.items, ...acc].map((g) => g.id),
      reasoning: explain(plan, cand.items, acc),
    }
    if (!validateOutfit(suggestion, plan.ctx, { plan, batch }).ok) continue
    out.push(suggestion)
    batch.push(suggestion)
    cand.items.forEach((g) => used.set(g.id, (used.get(g.id) ?? 0) + 1))
  }
  return out
}
