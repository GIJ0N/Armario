import type { AiProvider } from '../ai/provider'
import {
  buildTasteUser,
  TASTE_JSON_SCHEMA,
  TASTE_SUMMARY_MAX_CHARS,
  TASTE_SYSTEM,
  tasteResponseSchema,
  type RatedOutfitForPrompt,
} from '../ai/prompts/tasteProfile'
import { garmentAttributes, MAX_LIKED_EXAMPLES } from '../ai/prompts/stylist'
import type { FeedbackEntry, Garment, Repository } from '../db'
import { computeTaste, type TastePreferences } from '../engine'

/** Cada cuántas calificaciones nuevas se actualiza el perfil de gusto. */
export const TASTE_UPDATE_EVERY = 10
/** Calificaciones recientes que entran al resumen y al cálculo del motor. */
export const TASTE_WINDOW = 60

export interface LoadedTaste {
  preferences: TastePreferences
  summary: string
  likedOutfits: { garmentIds: string[]; reasoning: string }[]
}

/** Calificaciones vigentes: las hechas después de «Reiniciar gusto». */
function activeEntries(entries: FeedbackEntry[], resetAt: string): FeedbackEntry[] {
  return resetAt ? entries.filter((e) => e.createdAt > resetAt) : entries
}

/** Carga lo que el motor necesita del gusto (preferencias deterministas, perfil de texto y ejemplos). */
export async function loadTaste(repo: Repository, garments: Garment[]): Promise<LoadedTaste> {
  const [profile, recent] = await Promise.all([repo.taste.get(), repo.feedback.listRecent(TASTE_WINDOW)])
  const entries = activeEntries(recent, profile?.resetAt ?? '')
  const category = new Map(garments.map((g) => [g.id, g.category]))
  const liked = entries.filter((e) => e.rating === 'like').slice(0, MAX_LIKED_EXAMPLES)
  return {
    preferences: computeTaste(
      entries.map((e) => ({ rating: e.rating, tags: e.tags, garmentIds: e.garmentIds })),
      (id) => category.get(id),
    ),
    summary: profile?.summary ?? '',
    likedOutfits: liked.map((e) => ({ garmentIds: e.garmentIds, reasoning: e.reasoning })),
  }
}

/** Resumen determinista a partir de los motivos (sin IA). */
export function ruleBasedSummary(entries: Pick<FeedbackEntry, 'rating' | 'tags'>[]): string {
  const count = (rating: 'like' | 'dislike', tag: string) =>
    entries.filter((e) => e.rating === rating && e.tags.includes(tag)).length
  const dislikes = entries.filter((e) => e.rating === 'dislike').length
  const likes = entries.length - dislikes
  const parts: string[] = []
  const formal = count('dislike', 'too_formal')
  const casual = count('dislike', 'too_casual')
  if (formal >= 2 && formal > casual && formal * 2 >= dislikes) {
    parts.push('Prefiere un nivel de formalidad más bajo de lo que sugiere la ocasión.')
  } else if (casual >= 2 && casual > formal && casual * 2 >= dislikes) {
    parts.push('Prefiere un nivel de formalidad más alto de lo que sugiere la ocasión.')
  }
  if (count('dislike', 'colors') >= 2) parts.push('Le importa la paleta: evita las combinaciones de colores que ya descartó.')
  if (count('dislike', 'fit') >= 2) parts.push('Cuida la silueta: no le convencen ciertas proporciones.')
  if (count('dislike', 'weather') >= 2) parts.push('Pide que el outfit sea coherente con el clima del día.')
  if (count('dislike', 'repetitive') >= 2) parts.push('Busca variedad y se cansa de ver las mismas prendas.')
  if (count('dislike', 'uncomfortable') >= 2) parts.push('Prioriza la comodidad.')
  const liked: string[] = []
  if (count('like', 'comfortable') >= 2) liked.push('la comodidad')
  if (count('like', 'new_combo') >= 2) liked.push('las combinaciones nuevas')
  if (count('like', 'colors') >= 2) liked.push('los colores bien elegidos')
  if (count('like', 'perfect_occasion') >= 2) liked.push('que el outfit encaje con la ocasión')
  if (liked.length) parts.push(`Valora ${liked.join(', ')}.`)
  if (parts.length === 0) {
    parts.push(
      entries.length === 0
        ? 'Todavía no hay calificaciones para aprender tu gusto.'
        : `Aún no hay un patrón claro en tus calificaciones (${likes} «me gusta», ${dislikes} «no me gusta»).`,
    )
  }
  return parts.join(' ').slice(0, TASTE_SUMMARY_MAX_CHARS)
}

const inFlight = new WeakMap<Repository, Promise<string | null>>()

/**
 * Si hubo ≥ 10 calificaciones nuevas desde la última actualización del perfil, lo regenera
 * (con IA si hay; si no o si falla, con reglas) y lo guarda. Devuelve el texto o null si no tocaba.
 * Está pensada para ejecutarse en segundo plano: nunca lanza.
 */
export function maybeUpdateTasteProfile(repo: Repository, ai?: AiProvider): Promise<string | null> {
  // Una sola actualización a la vez; las calificaciones que lleguen durante ella cuentan para la siguiente.
  const pending = inFlight.get(repo)
  if (pending) return pending
  const run = (async () => {
    try {
      const profile = await repo.taste.get()
      const since = profile?.updatedAt ?? ''
      if ((await repo.feedback.countSince(since)) < TASTE_UPDATE_EVERY) return null
      const entries = activeEntries(await repo.feedback.listRecent(TASTE_WINDOW), profile?.resetAt ?? '')
      let summary: string | null = null
      if (ai) {
        try {
          const garments = new Map((await repo.list()).map((g) => [g.id, g]))
          const ratings: RatedOutfitForPrompt[] = entries.slice(0, 30).map((e) => ({
            rating: e.rating,
            tags: e.tags,
            comment: e.comment,
            occasion: e.occasion,
            garments: e.garmentIds.flatMap((id) => {
              const g = garments.get(id)
              return g ? [garmentAttributes(g)] : []
            }),
          }))
          const res = await ai.generateJson({
            system: TASTE_SYSTEM,
            user: buildTasteUser({ ratings, previousSummary: profile?.summary }),
            schema: tasteResponseSchema,
            jsonSchema: TASTE_JSON_SCHEMA,
          })
          summary = res.summary
        } catch {
          summary = null
        }
      }
      summary ??= ruleBasedSummary(entries)
      await repo.taste.save(summary)
      return summary
    } catch {
      return null
    }
  })()
  const tracked = run.finally(() => inFlight.delete(repo))
  inFlight.set(repo, tracked)
  return tracked
}
