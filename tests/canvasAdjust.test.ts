import { describe, expect, it } from 'vitest'
import {
  applyAdjustments,
  clampAdjust,
  diffDraft,
  getOffset,
  normalizeGarmentAdjust,
  normalizeItemAdjust,
  normalizeLayout,
  parseCanvasLayout,
  parseGarmentAdjust,
  pruneLayout,
  pxToViewBox,
  resetAll,
  resetItem,
  setOffset,
  setStacking,
  setTotalScale,
  stepTotalScale,
  totalScale,
  Z_MAX,
  type DraftAdjust,
} from '../src/canvas/adjust'
import { CANVAS_H, CANVAS_W, layoutOutfit, type PlacedBox } from '../src/canvas/layout'

const boxes: PlacedBox[] = layoutOutfit([
  { id: 'top', category: 'top', subcategory: 'Playera' },
  { id: 'bot', category: 'bottom', subcategory: 'Jeans' },
  { id: 'sh', category: 'shoes', subcategory: 'Tenis' },
])
const box = (id: string) => boxes.find((b) => b.id === id)!
const centre = (b: PlacedBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
const empty: DraftAdjust = { garments: {}, layout: {} }

describe('applyAdjustments', () => {
  it('sin ajustes devuelve las cajas automáticas (scale 1) sin modificar la entrada', () => {
    const copy = JSON.parse(JSON.stringify(boxes))
    const out = applyAdjustments(boxes, null, null)
    expect(out.map((b) => ({ ...b, scale: undefined }))).toEqual(boxes.map((b) => ({ ...b, scale: undefined })))
    expect(out.every((b) => b.scale === 1)).toBe(true)
    expect(boxes).toEqual(copy)
  })

  it('el tamaño escala alrededor del centro y dx/dy mueven el centro', () => {
    const [out] = applyAdjustments([box('top')], { top: { scale: 1.5, dx: 10, dy: -5 } }, null)
    const a = box('top')
    expect(out.w).toBeCloseTo(a.w * 1.5, 1)
    expect(out.h).toBeCloseTo(a.h * 1.5, 1)
    expect(centre(out).x).toBeCloseTo(centre(a).x + 10, 1)
    expect(centre(out).y).toBeCloseTo(centre(a).y - 5, 1)
    expect(out.scale).toBe(1.5)
  })

  it('compone: automática → prenda → outfit (tamaños se multiplican, desplazamientos se suman, z se suma)', () => {
    const [out] = applyAdjustments(
      [box('bot')],
      { bot: { scale: 1.2, dx: 4, dy: 0 } },
      { bot: { scale: 1.5, dx: 6, dy: 8, z: 3 } },
    )
    const a = box('bot')
    expect(out.w).toBeCloseTo(a.w * 1.8, 1)
    expect(centre(out).x).toBeCloseTo(centre(a).x + 10, 1)
    expect(centre(out).y).toBeCloseTo(centre(a).y + 8, 1)
    expect(out.z).toBe(a.z + 3)
    expect(out.scale).toBe(1.8)
  })

  it('acota el tamaño a 0.5–2.0 por capa', () => {
    const [big] = applyAdjustments([box('top')], { top: { scale: 9, dx: 0, dy: 0 } }, null)
    expect(big.scale).toBe(2)
    const [small] = applyAdjustments([box('top')], null, { top: { scale: 0.1, dx: 0, dy: 0, z: 0 } })
    expect(small.scale).toBe(0.5)
  })

  it('el centro nunca sale del viewBox y z se acota', () => {
    const [far] = applyAdjustments([box('top')], { top: { scale: 1, dx: 9999, dy: -9999 } }, { top: { scale: 1, dx: 0, dy: 0, z: 999 } })
    const c = centre(far)
    expect(c.x).toBeLessThanOrEqual(CANVAS_W)
    expect(c.y).toBeGreaterThanOrEqual(0)
    expect(far.z).toBe(box('top').z + Z_MAX)
  })

  it('ignora ids viejos y valores no finitos', () => {
    const out = applyAdjustments([box('top')], { gone: { scale: 2, dx: 5, dy: 5 } }, { gone: { scale: 2, dx: 5, dy: 5, z: 1 }, top: { scale: NaN, dx: NaN, dy: Infinity, z: NaN } })
    expect(out).toHaveLength(1)
    expect(out[0].scale).toBe(1)
    expect(centre(out[0]).x).toBeCloseTo(centre(box('top')).x, 1)
  })

  it('clampAdjust acota respecto a la caja base', () => {
    const c = clampAdjust(box('top'), { scale: 3, dx: -5000, dy: 5000 })
    expect(c.scale).toBe(2)
    expect(centre(box('top')).x + c.dx).toBeCloseTo(0, 5)
    expect(centre(box('top')).y + c.dy).toBeCloseTo(CANVAS_H, 5)
  })
})

describe('normalización', () => {
  it('redondea, acota y devuelve null si no cambia nada', () => {
    expect(normalizeGarmentAdjust({ scale: 1, dx: 0, dy: 0 })).toBeNull()
    expect(normalizeGarmentAdjust(null)).toBeNull()
    expect(normalizeGarmentAdjust({ scale: 1.2345, dx: 3.456, dy: -0.04 })).toEqual({ scale: 1.23, dx: 3.5, dy: 0 })
    expect(normalizeGarmentAdjust({ scale: 5, dx: 0, dy: 0 })).toEqual({ scale: 2, dx: 0, dy: 0 })
    expect(normalizeItemAdjust({ scale: 1, dx: 0, dy: 0, z: 0 })).toBeNull()
    expect(normalizeItemAdjust({ scale: 1, dx: 0, dy: 0, z: 2 })).toEqual({ scale: 1, dx: 0, dy: 0, z: 2 })
  })

  it('normalizeLayout / pruneLayout quitan identidades e ids viejos', () => {
    const layout = {
      a: { scale: 1.1, dx: 0, dy: 0, z: 0 },
      b: { scale: 1, dx: 0, dy: 0, z: 0 },
      c: { scale: 1, dx: 4, dy: 0, z: 0 },
    }
    expect(normalizeLayout(layout)).toEqual({ a: layout.a, c: layout.c })
    expect(pruneLayout(layout, ['a'])).toEqual({ a: layout.a })
    expect(pruneLayout(layout, ['b'])).toBeNull()
    expect(normalizeLayout(null)).toBeNull()
  })

  it('pxToViewBox es independiente del tamaño en pantalla', () => {
    expect(pxToViewBox(50, 100, { width: 160, height: 300 })).toEqual({ dx: 100, dy: 200 })
    expect(pxToViewBox(50, 100, { width: 320, height: 600 })).toEqual({ dx: 50, dy: 100 })
    expect(pxToViewBox(50, 100, { width: 0, height: 0 })).toEqual({ dx: 0, dy: 0 })
  })
})

describe('edición del borrador', () => {
  it('setOffset acota el centro; getOffset lo lee', () => {
    const d = setOffset(empty, box('top'), 'top', 'outfit', 8, -3)
    expect(getOffset(d, 'top', 'outfit')).toEqual({ dx: 8, dy: -3 })
    const far = setOffset(empty, box('top'), 'top', 'garment', 99999, 0)
    expect(centre(box('top')).x + getOffset(far, 'top', 'garment').dx).toBeCloseTo(CANVAS_W, 5)
  })

  it('el tamaño total lo absorbe la capa elegida sin tocar la otra', () => {
    let d: DraftAdjust = { garments: { top: { scale: 1.2, dx: 0, dy: 0 } }, layout: {} }
    expect(totalScale(d, 'top')).toBeCloseTo(1.2)
    d = setTotalScale(d, 'top', 'outfit', 1.5)
    expect(d.garments.top!.scale).toBe(1.2)
    expect(d.layout.top.scale).toBeCloseTo(1.25)
    expect(totalScale(d, 'top')).toBeCloseTo(1.5)
    d = setTotalScale(d, 'top', 'garment', 1.5)
    expect(d.garments.top!.scale).toBeCloseTo(1.2) // 1.5 / 1.25
    d = stepTotalScale(empty, 'top', 'outfit', 0.05)
    expect(totalScale(d, 'top')).toBeCloseTo(1.05)
    expect(setTotalScale(empty, 'top', 'outfit', 50).layout.top.scale).toBe(2)
  })

  it('Al frente / Atrás dejan la prenda por encima o debajo de todas', () => {
    const front = setStacking(empty, boxes, 'bot', 'front')
    const afterFront = applyAdjustments(boxes, null, front.layout)
    const zb = afterFront.find((b) => b.id === 'bot')!.z
    expect(afterFront.filter((b) => b.id !== 'bot').every((b) => b.z < zb)).toBe(true)
    const back = setStacking(front, boxes, 'top', 'back')
    const afterBack = applyAdjustments(boxes, null, back.layout)
    const zt = afterBack.find((b) => b.id === 'top')!.z
    expect(afterBack.filter((b) => b.id !== 'top').every((b) => b.z > zt)).toBe(true)
  })

  it('resetItem / resetAll limpian solo la capa indicada', () => {
    const d: DraftAdjust = {
      garments: { top: { scale: 1.3, dx: 0, dy: 0 } },
      layout: { top: { scale: 1.1, dx: 2, dy: 0, z: 1 }, bot: { scale: 1.1, dx: 0, dy: 0, z: 0 } },
    }
    expect(resetItem(d, 'top', 'outfit').layout).toEqual({ bot: d.layout.bot })
    expect(resetItem(d, 'top', 'outfit').garments.top).toEqual(d.garments.top)
    expect(resetItem(d, 'top', 'garment').garments.top).toBeNull()
    expect(resetAll(d, ['top', 'bot'], 'outfit').layout).toEqual({})
  })

  it('diffDraft reporta solo lo que cambió', () => {
    const before: DraftAdjust = { garments: { top: { scale: 1.2, dx: 0, dy: 0 } }, layout: {} }
    expect(diffDraft(before, before, ['top', 'bot']).changed).toBe(false)
    const after = setTotalScale(before, 'bot', 'garment', 1.4)
    const d = diffDraft(before, after, ['top', 'bot'])
    expect(d.changed).toBe(true)
    expect(d.garments).toEqual({ bot: { scale: 1.4, dx: 0, dy: 0 } })
    expect(d.layout).toBeNull()
    const o = diffDraft(before, { ...before, layout: { top: { scale: 1, dx: 5, dy: 0, z: 0 }, ghost: { scale: 2, dx: 0, dy: 0, z: 0 } } }, ['top', 'bot'])
    expect(o.layout).toEqual({ top: { scale: 1, dx: 5, dy: 0, z: 0 } })
  })
})

describe('lectura segura del JSON', () => {
  it('JSON válido pasa; inválido se ignora como null sin lanzar', () => {
    expect(parseGarmentAdjust('{"scale":1.15,"dx":2,"dy":0}')).toEqual({ scale: 1.15, dx: 2, dy: 0 })
    for (const bad of [null, undefined, '', '{', '[]', '{"scale":"x","dx":0,"dy":0}', '{"scale":1}', 42]) {
      expect(parseGarmentAdjust(bad)).toBeNull()
      expect(parseCanvasLayout(bad)).toBeNull()
    }
    expect(parseCanvasLayout('{"a":{"dx":1,"dy":2,"scale":1.2,"z":1}}')).toEqual({ a: { dx: 1, dy: 2, scale: 1.2, z: 1 } })
    expect(parseCanvasLayout('{"a":{"dx":1}}')).toBeNull()
    expect(parseGarmentAdjust('{"scale":9,"dx":0,"dy":0}')).toEqual({ scale: 2, dx: 0, dy: 0 })
  })
})
