import { z } from 'zod'
import { CANVAS_H, CANVAS_W, type PlacedBox, type Rect } from './layout'

/**
 * Ajuste manual del lienzo (fase 13a): dos capas opcionales sobre la colocación automática (`layoutOutfit`).
 * Caja final = automática → ajuste de la prenda (`garments.canvas_adjust`) → ajuste del outfit (`outfits.canvas_layout`).
 * Todo se guarda en unidades del viewBox (320×600) o como razones, nunca en píxeles de pantalla. Módulo puro.
 */

export const SCALE_MIN = 0.5
export const SCALE_MAX = 2
/** Desplazamiento de apilado (`z`) permitido respecto al orden automático. */
export const Z_MIN = -12
export const Z_MAX = 12
/** `z-index` base para que cualquier `z` posible quede por encima del maniquí (z-index 0). */
export const Z_INDEX_BASE = 1 - Z_MIN + 1

/** Ajuste por prenda: factor de tamaño y desplazamiento del centro (unidades del viewBox) respecto a su caja automática. */
export interface GarmentAdjust {
  scale: number
  dx: number
  dy: number
}

/** Ajuste por prenda dentro de un outfit; `z` suma al orden de apilado automático. */
export interface ItemAdjust extends GarmentAdjust {
  z: number
}

/** Mapa id de prenda → ajuste dentro de un outfit. */
export type OutfitLayout = Record<string, ItemAdjust>

export type GarmentAdjustMap = Readonly<Record<string, GarmentAdjust | null | undefined>>

/** Caja ya ajustada; `scale` es el factor total aplicado (prenda × outfit) respecto a la caja automática. */
export interface AdjustedBox extends PlacedBox {
  scale: number
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const round = (n: number, digits: number) => {
  const f = 10 ** digits
  return Math.round(n * f) / f + 0 // + 0 evita -0
}

export const clampScale = (s: number) => clamp(Number.isFinite(s) ? s : 1, SCALE_MIN, SCALE_MAX)
export const clampZ = (z: number) => clamp(Number.isFinite(z) ? Math.round(z) : 0, Z_MIN, Z_MAX)

/** Cuánto puede moverse el centro de `base` sin salir del viewBox. */
function deltaRange(base: Rect) {
  const cx = base.x + base.w / 2
  const cy = base.y + base.h / 2
  return { minDx: -cx, maxDx: CANVAS_W - cx, minDy: -cy, maxDy: CANVAS_H - cy }
}

/**
 * Acota un ajuste respecto a la caja `base` (la que tiene antes de esta capa): tamaño 0.5–2.0, `z` pequeño y centro
 * dentro del viewBox. No redondea.
 */
export function clampAdjust<T extends GarmentAdjust>(base: Rect, adj: T): T {
  const r = deltaRange(base)
  const finite = (n: number) => (Number.isFinite(n) ? n : 0)
  const out = {
    ...adj,
    scale: clampScale(adj.scale),
    dx: clamp(finite(adj.dx), r.minDx, r.maxDx),
    dy: clamp(finite(adj.dy), r.minDy, r.maxDy),
  }
  if ('z' in out) (out as unknown as ItemAdjust).z = clampZ((out as unknown as ItemAdjust).z)
  return out
}

/** Escala la caja alrededor de su centro y desplaza el centro; el resultado queda acotado. */
function applyLayer<T extends PlacedBox>(box: T, adj: GarmentAdjust): T {
  const c = clampAdjust(box, adj)
  const cx = box.x + box.w / 2 + c.dx
  const cy = box.y + box.h / 2 + c.dy
  const w = box.w * c.scale
  const h = box.h * c.scale
  return { ...box, x: round(cx - w / 2, 2), y: round(cy - h / 2, 2), w: round(w, 2), h: round(h, 2) }
}

export function applyGarmentAdjust<T extends PlacedBox>(box: T, adj: GarmentAdjust | null | undefined): T {
  return adj ? applyLayer(box, adj) : box
}

export function applyItemAdjust<T extends PlacedBox>(box: T, adj: ItemAdjust | null | undefined): T {
  if (!adj) return box
  const moved = applyLayer(box, adj)
  return { ...moved, z: box.z + clampZ(adj.z) }
}

/**
 * Compone las dos capas sobre las cajas automáticas. Las entradas de prendas que no están en `boxes` se ignoran
 * (ids viejos). No modifica la entrada.
 */
export function applyAdjustments(
  boxes: readonly PlacedBox[],
  garmentAdj?: GarmentAdjustMap | null,
  outfitAdj?: OutfitLayout | null,
): AdjustedBox[] {
  return boxes.map((box) => {
    const g = garmentAdj && has(garmentAdj, box.id) ? garmentAdj[box.id] : null
    const o = outfitAdj && has(outfitAdj, box.id) ? outfitAdj[box.id] : null
    const afterGarment = applyGarmentAdjust(box, g)
    const final = applyItemAdjust(afterGarment, o)
    return { ...final, scale: round(final.w / (box.w || 1), 2) }
  })
}

/* ---------- Identidad y normalización (valores guardados) ---------- */

export const isIdentityGarmentAdjust = (a: GarmentAdjust | null | undefined) =>
  !a || (a.scale === 1 && a.dx === 0 && a.dy === 0)

export const isIdentityItemAdjust = (a: ItemAdjust | null | undefined) => !a || (isIdentityGarmentAdjust(a) && a.z === 0)

const finiteOr = (n: number, d: number) => (Number.isFinite(n) ? n : d)

/**
 * Valores listos para guardar: acotados a los rangos globales (tamaño, z, y dx/dy dentro del viewBox), redondeados
 * (tamaño 2 decimales, desplazamientos 1 decimal) y `null` si equivalen a «sin ajuste».
 */
export function normalizeGarmentAdjust(a: GarmentAdjust | null | undefined): GarmentAdjust | null {
  if (!a) return null
  const out = {
    scale: round(clampScale(a.scale), 2),
    dx: round(clamp(finiteOr(a.dx, 0), -CANVAS_W, CANVAS_W), 1),
    dy: round(clamp(finiteOr(a.dy, 0), -CANVAS_H, CANVAS_H), 1),
  }
  return isIdentityGarmentAdjust(out) ? null : out
}

export function normalizeItemAdjust(a: ItemAdjust | null | undefined): ItemAdjust | null {
  if (!a) return null
  const g = normalizeGarmentAdjust({ scale: a.scale, dx: a.dx, dy: a.dy }) ?? { scale: 1, dx: 0, dy: 0 }
  const out = { ...g, z: clampZ(a.z) }
  return isIdentityItemAdjust(out) ? null : out
}

/** Normaliza cada entrada, quita las que no cambian nada y (si se indica) las de prendas que ya no están. null si queda vacío. */
export function normalizeLayout(layout: OutfitLayout | null | undefined, keepIds?: readonly string[]): OutfitLayout | null {
  if (!layout) return null
  const out: OutfitLayout = {}
  for (const id of Object.keys(layout)) {
    if (keepIds && !keepIds.includes(id)) continue
    const n = normalizeItemAdjust(layout[id])
    if (n) out[id] = n
  }
  return Object.keys(out).length ? out : null
}

/** Quita las entradas de prendas que ya no están en el outfit. */
export function pruneLayout(layout: OutfitLayout | null | undefined, keepIds: readonly string[]): OutfitLayout | null {
  return normalizeLayout(layout, keepIds)
}

export function layoutsEqual(a: OutfitLayout | null | undefined, b: OutfitLayout | null | undefined): boolean {
  return JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b))
}

export function garmentAdjustsEqual(a: GarmentAdjust | null | undefined, b: GarmentAdjust | null | undefined): boolean {
  return JSON.stringify(normalizeGarmentAdjust(a)) === JSON.stringify(normalizeGarmentAdjust(b))
}

/* ---------- Pantalla → viewBox ---------- */

/** Convierte un desplazamiento en píxeles de pantalla a unidades del viewBox según el tamaño real del lienzo. */
export function pxToViewBox(dxPx: number, dyPx: number, rect: { width: number; height: number }): { dx: number; dy: number } {
  if (!(rect.width > 0) || !(rect.height > 0)) return { dx: 0, dy: 0 }
  return { dx: (dxPx * CANVAS_W) / rect.width, dy: (dyPx * CANVAS_H) / rect.height }
}

/* ---------- Edición interactiva ---------- */

export type AdjustTarget = 'outfit' | 'garment'

export interface DraftAdjust {
  /** Ajustes por prenda (capa «Siempre para esta prenda»). */
  garments: Record<string, GarmentAdjust | null>
  /** Ajustes de este outfit. */
  layout: OutfitLayout
}

const ID: GarmentAdjust = { scale: 1, dx: 0, dy: 0 }
const IDI: ItemAdjust = { ...ID, z: 0 }

/** Factor de tamaño total (prenda × outfit) de una prenda en el borrador. */
export function totalScale(draft: DraftAdjust, id: string): number {
  const g = clampScale((draft.garments[id] ?? ID).scale)
  const o = clampScale((draft.layout[id] ?? IDI).scale)
  return g * o
}

/** Caja de `id` justo antes de la capa `target` (para acotar el centro). */
function baseFor(auto: PlacedBox, draft: DraftAdjust, id: string, target: AdjustTarget): PlacedBox {
  return target === 'garment' ? auto : applyGarmentAdjust(auto, draft.garments[id])
}

/**
 * Pone el desplazamiento de la capa `target` en (dx, dy) absolutos (unidades del viewBox, relativos a la caja de esa
 * capa), acotado para que el centro siga dentro del lienzo.
 */
export function setOffset(draft: DraftAdjust, auto: PlacedBox, id: string, target: AdjustTarget, dx: number, dy: number): DraftAdjust {
  const base = baseFor(auto, draft, id, target)
  if (target === 'garment') {
    const cur = draft.garments[id] ?? ID
    return { ...draft, garments: { ...draft.garments, [id]: clampAdjust(base, { ...cur, dx, dy }) } }
  }
  const cur = draft.layout[id] ?? IDI
  return { ...draft, layout: { ...draft.layout, [id]: clampAdjust(base, { ...cur, dx, dy }) } }
}

export function getOffset(draft: DraftAdjust, id: string, target: AdjustTarget): { dx: number; dy: number } {
  const cur = target === 'garment' ? (draft.garments[id] ?? ID) : (draft.layout[id] ?? IDI)
  return { dx: cur.dx, dy: cur.dy }
}

/**
 * Pone el tamaño TOTAL (prenda × outfit) de la prenda: la capa `target` absorbe el cambio y la otra no se toca.
 * Acotado a 0.5–2.0 por capa.
 */
export function setTotalScale(draft: DraftAdjust, id: string, target: AdjustTarget, total: number): DraftAdjust {
  const g = clampScale((draft.garments[id] ?? ID).scale)
  const o = clampScale((draft.layout[id] ?? IDI).scale)
  if (target === 'garment') {
    const cur = draft.garments[id] ?? ID
    return { ...draft, garments: { ...draft.garments, [id]: { ...cur, scale: clampScale(total / o) } } }
  }
  const cur = draft.layout[id] ?? IDI
  void g
  return { ...draft, layout: { ...draft.layout, [id]: { ...cur, scale: clampScale(total / g) } } }
}

/** Cambia el tamaño total sumando `delta` (p. ej. ±0.05). */
export function stepTotalScale(draft: DraftAdjust, id: string, target: AdjustTarget, delta: number): DraftAdjust {
  return setTotalScale(draft, id, target, round(totalScale(draft, id) + delta, 3))
}

/** Calcula `z` de `id` (relativo al orden automático) para dejarlo por encima o por debajo de las demás. */
export function setStacking(
  draft: DraftAdjust,
  autoBoxes: readonly PlacedBox[],
  id: string,
  where: 'front' | 'back',
): DraftAdjust {
  const auto = autoBoxes.find((b) => b.id === id)
  if (!auto) return draft
  const others = autoBoxes
    .filter((b) => b.id !== id)
    .map((b) => b.z + clampZ((draft.layout[b.id] ?? IDI).z))
  const cur = draft.layout[id] ?? IDI
  if (others.length === 0) return { ...draft, layout: { ...draft.layout, [id]: { ...cur, z: 0 } } }
  const target = where === 'front' ? Math.max(...others) + 1 : Math.min(...others) - 1
  return { ...draft, layout: { ...draft.layout, [id]: { ...cur, z: clampZ(target - auto.z) } } }
}

/** Quita el ajuste de `id` en la capa `target` (en «Este outfit» también restablece el orden de apilado). */
export function resetItem(draft: DraftAdjust, id: string, target: AdjustTarget): DraftAdjust {
  if (target === 'garment') {
    const garments = { ...draft.garments }
    garments[id] = null
    return { ...draft, garments }
  }
  const layout = { ...draft.layout }
  delete layout[id]
  return { ...draft, layout }
}

/** Quita todos los ajustes de la capa `target` (todas las prendas pasadas en `ids`). */
export function resetAll(draft: DraftAdjust, ids: readonly string[], target: AdjustTarget): DraftAdjust {
  let next = draft
  for (const id of ids) next = resetItem(next, id, target)
  return next
}

/** Resultado de «Listo»: el outfit nuevo y solo las prendas cuyo ajuste cambió. */
export interface AdjustChange {
  layout: OutfitLayout | null
  garments: Record<string, GarmentAdjust | null>
}

export function diffDraft(
  before: DraftAdjust,
  after: DraftAdjust,
  ids: readonly string[],
): AdjustChange & { changed: boolean } {
  const layout = normalizeLayout(after.layout, ids)
  const garments: Record<string, GarmentAdjust | null> = {}
  for (const id of ids) {
    const a = normalizeGarmentAdjust(after.garments[id])
    if (!garmentAdjustsEqual(before.garments[id], a)) garments[id] = a
  }
  const changed = !layoutsEqual(before.layout, layout) || Object.keys(garments).length > 0
  return { layout, garments, changed }
}

/* ---------- Lectura segura (JSON de la base) ---------- */

const num = z.number()
const garmentAdjustSchema = z.object({ scale: num, dx: num, dy: num })
const itemAdjustSchema = z.object({ scale: num, dx: num, dy: num, z: num })
const layoutSchema = z.record(z.string(), itemAdjustSchema)

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/** JSON de `garments.canvas_adjust`; inválido o vacío → null (nunca lanza). */
export function parseGarmentAdjust(raw: unknown): GarmentAdjust | null {
  const parsed = garmentAdjustSchema.safeParse(parseJson(raw))
  return parsed.success ? normalizeGarmentAdjust(parsed.data) : null
}

/** JSON de `outfits.canvas_layout`; inválido o vacío → null (nunca lanza). */
export function parseCanvasLayout(raw: unknown): OutfitLayout | null {
  const parsed = layoutSchema.safeParse(parseJson(raw))
  return parsed.success ? normalizeLayout(parsed.data) : null
}
