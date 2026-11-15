import type { Category } from '../db/types'

/** Lienzo del maniquí: unidades del viewBox (el maniquí mira de frente y está centrado en CX). */
export const CANVAS_W = 320
export const CANVAS_H = 600
export const CX = CANVAS_W / 2

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type Anchor = 'top' | 'bottom' | 'center'

export type ZoneName =
  | 'torso'
  | 'torso-center'
  | 'outer'
  | 'legs'
  | 'knees'
  | 'feet'
  | 'head'
  | 'face'
  | 'neck'
  | 'wrist'
  | 'waist'
  | 'side'

export type AccessoryKind = 'head' | 'face' | 'neck' | 'wrist' | 'waist' | 'side'

export interface LayoutInput {
  id: string
  category: Category
  subcategory: string
  /** Ancho/alto natural de la imagen mostrada; null/undefined si aún no se conoce. */
  aspect?: number | null
  /** true = foto original o recorte rectangular: se muestra en un mosaico enmarcado. */
  framed?: boolean
}

export interface PlacedBox extends Rect {
  id: string
  /** Orden de apilado sobre el maniquí (mayor = encima). */
  z: number
  zone: ZoneName
  framed: boolean
  rotate?: number
}

interface Zone extends Rect {
  anchor: Anchor
}

export const ZONES = {
  torso: { x: CX - 80, y: 100, w: 160, h: 180, anchor: 'top' },
  // Con abrigo abierto: la prenda de arriba queda visible en una columna central más angosta.
  'torso-center': { x: CX - 54, y: 112, w: 108, h: 150, anchor: 'top' },
  outer: { x: CX - 100, y: 96, w: 200, h: 215, anchor: 'top' },
  legs: { x: CX - 80, y: 262, w: 160, h: 284, anchor: 'top' },
  knees: { x: CX - 80, y: 262, w: 160, h: 130, anchor: 'top' },
  feet: { x: CX - 95, y: 536, w: 190, h: 60, anchor: 'bottom' },
  head: { x: CX - 40, y: 12, w: 80, h: 52, anchor: 'bottom' },
  face: { x: CX - 30, y: 44, w: 60, h: 22, anchor: 'center' },
  neck: { x: CX - 42, y: 92, w: 84, h: 40, anchor: 'center' },
  waist: { x: CX - 64, y: 254, w: 128, h: 22, anchor: 'center' },
} satisfies Record<string, Zone>

/** Muñecas: izquierda y derecha del espectador. */
const WRIST_SLOTS: Rect[] = [
  { x: 56, y: 268, w: 34, h: 34 },
  { x: CANVAS_W - 56 - 34, y: 268, w: 34, h: 34 },
]

/** Columnas laterales para bolsas y «otros»: derecha primero, luego izquierda; de abajo hacia arriba. */
const SIDE_SLOTS: Rect[] = [
  { x: 256, y: 250, w: 62, h: 84 },
  { x: 2, y: 250, w: 62, h: 84 },
  { x: 256, y: 150, w: 62, h: 84 },
  { x: 2, y: 150, w: 62, h: 84 },
]

/** Relación ancho/alto típica cuando la imagen aún no se conoce. */
export const DEFAULT_ASPECT: Record<Category, number> = {
  top: 1.1,
  bottom: 0.6,
  shoes: 2,
  outerwear: 1,
  accessory: 1,
}

const ACCESSORY_DEFAULT_ASPECT: Record<AccessoryKind, number> = {
  head: 1.4,
  face: 2.5,
  neck: 1.5,
  wrist: 1,
  waist: 5,
  side: 1,
}

/** Tamaño máximo (unidades) del mosaico enmarcado. */
const TILE_MAX = 88

const Z = { bottom: 1, shoes: 1, top: 2, outerwear: 3, waist: 6, accessory: 7, neck: 8 } as const

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const has = (s: string, words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(normalize(s)))

/** Pantalón corto: la zona llega a las rodillas en lugar de a los tobillos. */
export function isShorts(subcategory: string): boolean {
  return has(subcategory, ['short', 'bermuda', 'falda', 'skirt'])
}

export function accessoryKind(subcategory: string): AccessoryKind {
  if (has(subcategory, ['gorra', 'cap\\b', 'sombrero', 'gorro', 'beanie', 'boina', 'hat\\b', 'visera'])) return 'head'
  if (has(subcategory, ['lente', 'gafa', 'anteojo', 'sunglass', 'glasses'])) return 'face'
  if (has(subcategory, ['bufanda', 'scarf', 'panuelo', 'corbata', 'tie\\b', 'collar', 'bandana']))
    return 'neck'
  if (has(subcategory, ['reloj', 'pulsera', 'watch', 'bracelet', 'brazalete', 'smartwatch'])) return 'wrist'
  if (has(subcategory, ['cinturon', 'cinto', 'belt'])) return 'waist'
  return 'side'
}

/** Ajusta una imagen de relación `aspect` dentro de `zone` sin recortarla ni deformarla (contain). */
export function fitContain(aspect: number, zone: Rect, anchor: Anchor): Rect {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  let w = zone.w
  let h = w / a
  if (h > zone.h) {
    h = zone.h
    w = h * a
  }
  const x = zone.x + (zone.w - w) / 2
  const y = anchor === 'top' ? zone.y : anchor === 'bottom' ? zone.y + zone.h - h : zone.y + (zone.h - h) / 2
  return { x, y, w, h }
}

const round = (n: number) => Math.round(n * 10) / 10

function place(
  item: LayoutInput,
  zoneName: ZoneName,
  zone: Zone | (Rect & { anchor?: Anchor }),
  z: number,
  fallbackAspect: number,
): PlacedBox {
  const anchor = zone.anchor ?? 'center'
  const framed = !!item.framed
  const rect: Rect = framed ? tileIn(zone, anchor) : fitContain(item.aspect ?? fallbackAspect, zone, anchor)
  return { id: item.id, x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h), z, zone: zoneName, framed }
}

function tileIn(zone: Rect, anchor: Anchor): Rect {
  const s = Math.min(zone.w, zone.h, TILE_MAX)
  const x = zone.x + (zone.w - s) / 2
  const y = anchor === 'bottom' ? zone.y + zone.h - s : zone.y + (zone.h - s) / 2
  return { x, y, w: s, h: s }
}

/** El lienzo solo tiene sentido si el outfit tiene al menos una prenda de arriba o de abajo. */
export function canRenderCanvas(items: Pick<LayoutInput, 'category'>[]): boolean {
  return items.some((i) => i.category === 'top' || i.category === 'bottom')
}

/**
 * Coloca cada prenda sobre el maniquí. Función pura y determinista.
 * - top: torso; bottom: cadera a tobillos (pantalón corto: a rodillas); shoes: pies (un par, centrado).
 * - outerwear: sobre el torso y más ancho; si también hay top, el top se superpone en una columna
 *   central angosta («abrigo abierto») para que siga visible.
 * - accessory: por palabras clave de la subcategoría (gorra→cabeza, reloj→muñeca, cinturón→cintura, …).
 */
export function layoutOutfit(items: LayoutInput[]): PlacedBox[] {
  const hasTop = items.some((i) => i.category === 'top')
  const out: PlacedBox[] = []
  let tops = 0
  let wrist = 0
  let side = 0

  for (const item of items) {
    switch (item.category) {
      case 'top': {
        const z = hasTop && items.some((i) => i.category === 'outerwear') ? Z.outerwear + 1 + tops : Z.top + tops
        const covered = items.some((i) => i.category === 'outerwear')
        out.push(place(item, covered ? 'torso-center' : 'torso', covered ? ZONES['torso-center'] : ZONES.torso, z, DEFAULT_ASPECT.top))
        tops++
        break
      }
      case 'outerwear': {
        // Con top: el abrigo queda debajo (z menor) y más ancho; el top asoma en el centro.
        out.push(place(item, 'outer', ZONES.outer, hasTop ? Z.top : Z.outerwear, DEFAULT_ASPECT.outerwear))
        break
      }
      case 'bottom': {
        const shorts = isShorts(item.subcategory)
        out.push(
          place(item, shorts ? 'knees' : 'legs', shorts ? ZONES.knees : ZONES.legs, Z.bottom, shorts ? 1.1 : DEFAULT_ASPECT.bottom),
        )
        break
      }
      case 'shoes':
        out.push(place(item, 'feet', ZONES.feet, Z.shoes, DEFAULT_ASPECT.shoes))
        break
      case 'accessory': {
        const kind = accessoryKind(item.subcategory)
        const fb = ACCESSORY_DEFAULT_ASPECT[kind]
        if (kind === 'wrist') {
          out.push(place(item, 'wrist', { ...WRIST_SLOTS[Math.min(wrist++, WRIST_SLOTS.length - 1)], anchor: 'center' }, Z.accessory, fb))
        } else if (kind === 'side') {
          out.push(place(item, 'side', { ...SIDE_SLOTS[Math.min(side++, SIDE_SLOTS.length - 1)], anchor: 'top' }, Z.accessory, fb))
        } else {
          const zone = ZONES[kind]
          out.push(place(item, kind, zone, kind === 'waist' ? Z.waist : kind === 'neck' ? Z.neck : Z.accessory, fb))
        }
        break
      }
    }
  }
  return out
}
