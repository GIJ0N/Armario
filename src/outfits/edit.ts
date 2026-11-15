import type { NewOutfitSwap, Occasion, Outfit, Repository } from '../db'
import type { Weather } from '../engine'

export const EDITED_REASONING = 'Editado a mano.'
export const MANUAL_REASONING = 'Armado a mano.'

/**
 * Cambios entre dos listas de prendas: cada prenda que sale se empareja con la que entra de la misma categoría
 * (cambio); las que sobran son «solo quitada» (toGarmentId null) o «solo agregada» (fromGarmentId null).
 */
export function diffSwaps(
  before: string[],
  after: string[],
  categoryOf: (id: string) => string | undefined,
): Pick<NewOutfitSwap, 'fromGarmentId' | 'toGarmentId'>[] {
  const removed = before.filter((id) => !after.includes(id))
  const added = after.filter((id) => !before.includes(id))
  const out: Pick<NewOutfitSwap, 'fromGarmentId' | 'toGarmentId'>[] = []
  const left = [...added]
  for (const from of removed) {
    const i = left.findIndex((to) => categoryOf(to) === categoryOf(from))
    if (i >= 0) out.push({ fromGarmentId: from, toGarmentId: left.splice(i, 1)[0] })
    else out.push({ fromGarmentId: from, toGarmentId: null })
  }
  for (const to of left) out.push({ fromGarmentId: null, toGarmentId: to })
  return out
}

export interface EditParams {
  /** Fila actual del outfit; null si todavía no está guardada en el historial (o se arma desde cero). */
  original: Outfit | null
  /** Prendas antes del cambio (para registrar los cambios); [] al armar desde cero. */
  baseIds: string[]
  next: { garmentIds: string[]; occasion: Occasion; weather: Weather | null; reasoning?: string }
  categoryOf: (id: string) => string | undefined
}

export interface EditResult {
  outfit: Outfit
  /** true si se creó una fila nueva (la original se conserva con su historial). */
  createdNew: boolean
}

/**
 * Regla de edición: si el outfit ya tiene una calificación o algún uso, NO se reescribe (feedback y usos
 * referencian `outfit_id` y deben seguir describiendo lo que se calificó o se usó): se crea una fila nueva con
 * source 'manual' y, si la original estaba guardada, el guardado (y su nombre) pasan a la nueva. Si no tiene
 * historial se actualiza en su lugar (también pasa a 'manual'). Siempre se registran los cambios como señal de gusto.
 */
export async function commitOutfitEdit(repo: Repository, params: EditParams): Promise<EditResult> {
  const { original, baseIds, next, categoryOf } = params
  const reasoning = next.reasoning ?? (baseIds.length ? EDITED_REASONING : MANUAL_REASONING)
  let outfit: Outfit
  let createdNew: boolean
  if (original && !(await repo.outfits.hasHistory(original.id))) {
    outfit = await repo.outfits.updateItems(original.id, { garmentIds: next.garmentIds, reasoning, occasion: next.occasion })
    createdNew = false
  } else {
    outfit = await repo.outfits.create({
      garment_ids: next.garmentIds,
      occasion: next.occasion,
      weather_snapshot: next.weather,
      reasoning,
      source: 'manual',
    })
    createdNew = true
    if (original?.saved_at) {
      outfit = await repo.outfits.save(outfit.id, original.name ?? undefined)
      await repo.outfits.unsave(original.id)
    }
  }
  const swaps = diffSwaps(baseIds, next.garmentIds, categoryOf)
  await repo.swaps.record(swaps.map((s) => ({ ...s, outfitId: outfit.id })))
  return { outfit, createdNew }
}

/** «Crear outfit»: arma un outfit manual desde cero y lo deja guardado en Armario › Outfits. */
export async function createManualOutfit(
  repo: Repository,
  params: { garmentIds: string[]; occasion: Occasion; name?: string; categoryOf: (id: string) => string | undefined },
): Promise<Outfit> {
  const { outfit } = await commitOutfitEdit(repo, {
    original: null,
    baseIds: [],
    next: { garmentIds: params.garmentIds, occasion: params.occasion, weather: null },
    categoryOf: params.categoryOf,
  })
  return repo.outfits.save(outfit.id, params.name)
}
