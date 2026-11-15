import { describe, expect, it } from 'vitest'
import {
  CANVAS_H,
  CANVAS_W,
  DEFAULT_ASPECT,
  TUCK_OVERLAP,
  ZONES,
  accessoryKind,
  canRenderCanvas,
  fitContain,
  isShorts,
  layoutOutfit,
  type LayoutInput,
} from '../src/canvas/layout'

const item = (id: string, category: LayoutInput['category'], subcategory = '', aspect?: number | null, framed = false): LayoutInput => ({
  id,
  category,
  subcategory,
  aspect,
  framed,
})
const box = (list: ReturnType<typeof layoutOutfit>, id: string) => list.find((b) => b.id === id)!

describe('fitContain', () => {
  it('ajusta una imagen ancha al ancho de la zona y la ancla arriba, abajo o al centro', () => {
    const zone = { x: 10, y: 100, w: 100, h: 200 }
    expect(fitContain(2, zone, 'top')).toEqual({ x: 10, y: 100, w: 100, h: 50 })
    expect(fitContain(2, zone, 'bottom')).toEqual({ x: 10, y: 250, w: 100, h: 50 })
    expect(fitContain(2, zone, 'center')).toEqual({ x: 10, y: 175, w: 100, h: 50 })
  })
  it('ajusta una imagen alta a la altura de la zona y la centra en horizontal', () => {
    const r = fitContain(0.25, { x: 0, y: 0, w: 100, h: 200 }, 'top')
    expect(r).toEqual({ x: 25, y: 0, w: 50, h: 200 })
  })
  it('nunca excede la zona y conserva la relación', () => {
    for (const a of [0.2, 0.7, 1, 1.6, 5]) {
      const r = fitContain(a, { x: 0, y: 0, w: 90, h: 40 }, 'center')
      expect(r.w).toBeLessThanOrEqual(90 + 1e-9)
      expect(r.h).toBeLessThanOrEqual(40 + 1e-9)
      expect(r.w / r.h).toBeCloseTo(a)
    }
  })
  it('una relación inválida se trata como cuadrada', () => {
    expect(fitContain(0, { x: 0, y: 0, w: 50, h: 80 }, 'top')).toEqual({ x: 0, y: 0, w: 50, h: 50 })
    expect(fitContain(NaN, { x: 0, y: 0, w: 50, h: 80 }, 'top').w).toBe(50)
  })
})

describe('layoutOutfit: zonas por categoría', () => {
  const list = layoutOutfit([
    item('t', 'top', 'Playera', 1),
    item('b', 'bottom', 'Jeans', 0.6),
    item('s', 'shoes', 'Tenis', 2),
  ])
  it('top en el torso, bottom de la cadera a los tobillos y zapatos en los pies', () => {
    expect(box(list, 't').zone).toBe('torso')
    expect(box(list, 'b').zone).toBe('legs')
    expect(box(list, 's').zone).toBe('feet')
    expect(box(list, 't').y).toBeLessThan(box(list, 'b').y)
    expect(box(list, 'b').y).toBeLessThan(box(list, 's').y)
  })
  it('el top se ancla arriba y se centra; los zapatos se anclan abajo y se centran', () => {
    const t = box(list, 't')
    expect(t.y).toBe(ZONES.torso.y)
    expect(t.x + t.w / 2).toBeCloseTo(CANVAS_W / 2)
    const s = box(list, 's')
    expect(s.y + s.h).toBeCloseTo(ZONES.feet.y + ZONES.feet.h)
    expect(s.x + s.w / 2).toBeCloseTo(CANVAS_W / 2)
  })
  it('todas las cajas quedan dentro del lienzo', () => {
    for (const b of list) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(CANVAS_W)
      expect(b.y + b.h).toBeLessThanOrEqual(CANVAS_H)
    }
  })
  it('los pantalones cortos llegan solo a las rodillas', () => {
    const pants = layoutOutfit([item('p', 'bottom', 'Pantalón', 0.5)])[0]
    const shorts = layoutOutfit([item('p', 'bottom', 'Bermuda', 1)])[0]
    expect(pants.zone).toBe('legs')
    expect(shorts.zone).toBe('knees')
    expect(shorts.y + shorts.h).toBeLessThan(pants.y + pants.h)
    expect(isShorts('Shorts deportivos')).toBe(true)
    expect(isShorts('Jeans')).toBe(false)
  })
})

describe('layoutOutfit: abrigo', () => {
  it('solo abrigo: sobre el torso y más ancho que un top', () => {
    const coat = box(layoutOutfit([item('c', 'outerwear', 'Chamarra', 1)]), 'c')
    const top = box(layoutOutfit([item('t', 'top', 'Playera', 1)]), 't')
    expect(coat.zone).toBe('outer')
    expect(coat.w).toBeGreaterThan(top.w)
  })
  it('abrigo + top: el top queda visible, encima y dentro de una columna central más angosta', () => {
    const list = layoutOutfit([item('t', 'top', 'Playera', 1.1), item('c', 'outerwear', 'Chamarra', 1)])
    const t = box(list, 't')
    const c = box(list, 'c')
    expect(t.z).toBeGreaterThan(c.z)
    expect(t.w).toBeLessThan(c.w)
    // La caja del top cae dentro de la del abrigo y no queda cubierta por ella.
    expect(t.x).toBeGreaterThanOrEqual(c.x)
    expect(t.x + t.w).toBeLessThanOrEqual(c.x + c.w)
    expect(t.y).toBeGreaterThanOrEqual(c.y)
    expect(t.x + t.w / 2).toBeCloseTo(CANVAS_W / 2)
  })
})

describe('layoutOutfit: accesorios', () => {
  it.each([
    ['Gorra', 'head'],
    ['Sombrero de paja', 'head'],
    ['Lentes de sol', 'face'],
    ['Reloj', 'wrist'],
    ['Pulsera', 'wrist'],
    ['Cinturón', 'waist'],
    ['Bufanda', 'neck'],
    ['Mochila', 'side'],
    ['Bolsa', 'side'],
    ['Cosa rara', 'side'],
    ['', 'side'],
  ])('«%s» va en %s', (sub, kind) => {
    expect(accessoryKind(sub)).toBe(kind)
    expect(layoutOutfit([item('a', 'accessory', sub)])[0].zone).toBe(kind)
  })
  it('la gorra queda sobre la cabeza, el cinturón en la cintura sobre la ropa y la mochila al costado derecho', () => {
    const list = layoutOutfit([
      item('t', 'top', 'Playera'),
      item('b', 'bottom', 'Jeans'),
      item('g', 'accessory', 'Gorra', 1.4),
      item('n', 'accessory', 'Cinturón', 5),
      item('m', 'accessory', 'Mochila', 1),
    ])
    expect(box(list, 'g').y + box(list, 'g').h).toBeLessThanOrEqual(ZONES.torso.y)
    expect(box(list, 'n').z).toBeGreaterThan(box(list, 't').z)
    expect(box(list, 'n').z).toBeGreaterThan(box(list, 'b').z)
    expect(box(list, 'm').x).toBeGreaterThan(CANVAS_W / 2 + 60)
  })
  it('varias bolsas no se encimen', () => {
    const list = layoutOutfit([item('1', 'accessory', 'Bolsa'), item('2', 'accessory', 'Mochila')])
    expect(box(list, '1').x === box(list, '2').x && box(list, '1').y === box(list, '2').y).toBe(false)
  })
})

describe('layoutOutfit: relación de aspecto', () => {
  it('sin relación conocida usa la típica de la categoría', () => {
    const a = box(layoutOutfit([item('t', 'top', 'Playera')]), 't')
    const b = box(layoutOutfit([item('t', 'top', 'Playera', DEFAULT_ASPECT.top)]), 't')
    expect(a).toEqual(b)
    expect(layoutOutfit([item('t', 'top', 'Playera', null)])[0]).toEqual(a)
  })
  it('un pantalón ancho se limita por ancho y uno angosto por alto', () => {
    const wide = box(layoutOutfit([item('p', 'bottom', 'Jeans', 1.2)]), 'p')
    const slim = box(layoutOutfit([item('p', 'bottom', 'Jeans', 0.3)]), 'p')
    expect(wide.w).toBeCloseTo(ZONES.legs.w)
    expect(slim.h).toBeCloseTo(ZONES.legs.h)
    expect(wide.w / wide.h).toBeCloseTo(1.2, 1)
  })
})

describe('layoutOutfit: mosaico enmarcado', () => {
  it('una foto sin transparencia ocupa ~80 % de la altura de su zona y conserva su forma', () => {
    const framed = box(layoutOutfit([item('t', 'top', 'Playera', 0.9, true)]), 't')
    expect(framed.framed).toBe(true)
    expect(framed.h).toBeCloseTo(ZONES.torso.h * 0.8, 0)
    expect(framed.w / framed.h).toBeCloseTo(0.9, 1)
    expect(framed.x + framed.w / 2).toBeCloseTo(CANVAS_W / 2)
    expect(framed.y).toBeGreaterThanOrEqual(ZONES.torso.y)
    expect(framed.y + framed.h).toBeLessThanOrEqual(ZONES.torso.y + ZONES.torso.h)
  })
  it('el mosaico de un pantalón se ancla en las piernas: de la cintura hacia los tobillos', () => {
    const t = box(layoutOutfit([item('p', 'bottom', 'Jeans', 0.75, true)]), 'p')
    expect(t.zone).toBe('legs')
    expect(t.h).toBeGreaterThan(ZONES.legs.h * 0.75)
    expect(t.y).toBeGreaterThanOrEqual(ZONES.legs.y)
    expect(t.y + t.h).toBeLessThanOrEqual(ZONES.legs.y + ZONES.legs.h)
    expect(t.y + t.h).toBeGreaterThan(450)
  })
  it('los zapatos enmarcados se anclan abajo; sin relación conocida usa la típica acotada', () => {
    const s = box(layoutOutfit([item('s', 'shoes', 'Tenis', null, true)]), 's')
    expect(s.y + s.h).toBeLessThanOrEqual(ZONES.feet.y + ZONES.feet.h)
    expect(s.w / s.h).toBeLessThanOrEqual(1.8 + 0.05)
  })
})

describe('layoutOutfit: regla de altura primero (relaciones realistas)', () => {
  const list = layoutOutfit([
    item('jeans', 'bottom', 'Jeans', 0.45),
    item('tee', 'top', 'Playera', 1.1),
    item('shoe', 'shoes', 'Tenis', 2.2),
  ])
  it('los jeans llegan de la cintura (≈256) a los tobillos (≈536) y son más angostos que el máximo', () => {
    const j = box(list, 'jeans')
    expect(j.y).toBeCloseTo(256, 0)
    expect(j.y + j.h).toBeGreaterThanOrEqual(535)
    expect(j.h).toBeCloseTo(ZONES.legs.h, 0)
    expect(j.w).toBeCloseTo(280 * 0.45, 0)
    expect(j.x + j.w / 2).toBeCloseTo(CANVAS_W / 2)
  })
  it('la playera va del hombro a la cadera, ancha pero con tope de 200', () => {
    const t = box(list, 'tee')
    expect(t.y).toBeCloseTo(98, 0)
    expect(t.w).toBeLessThanOrEqual(200)
    expect(t.w / t.h).toBeCloseTo(1.1, 1)
    // metida: se superpone ~12 con la cintura del pantalón y queda encima
    const j = box(list, 'jeans')
    expect(t.y + t.h - j.y).toBeCloseTo(TUCK_OVERLAP, 0)
    expect(t.z).toBeGreaterThan(j.z)
  })
  it('los tenis (2.2) se limitan por altura y quedan centrados abajo', () => {
    const s = box(list, 'shoe')
    expect(s.h).toBeCloseTo(ZONES.feet.h, 0)
    expect(s.w).toBeCloseTo(ZONES.feet.h * 2.2, 0)
    expect(s.z).toBeGreaterThanOrEqual(box(list, 'jeans').z)
  })
  it('una chamarra (0.9) es algo más grande que una playera y se reduce de forma uniforme si se pasa del ancho', () => {
    const jacket = box(layoutOutfit([item('c', 'outerwear', 'Chamarra', 0.9)]), 'c')
    const tee = box(layoutOutfit([item('t', 'top', 'Playera', 0.9)]), 't')
    expect(jacket.h).toBeGreaterThan(tee.h)
    expect(jacket.w / jacket.h).toBeCloseTo(0.9, 1)
    const wide = box(layoutOutfit([item('c', 'outerwear', 'Chamarra', 1.6)]), 'c')
    expect(wide.w).toBeCloseTo(ZONES.outer.w, 0)
    expect(wide.w / wide.h).toBeCloseTo(1.6, 1)
  })
  it('unos jeans muy anchos (holgados, 0.8) pueden sobresalir del cuerpo hasta ~190 sin bajar de la altura objetivo', () => {
    const j = box(layoutOutfit([item('j', 'bottom', 'Jeans', 0.65)]), 'j')
    expect(j.h).toBeCloseTo(ZONES.legs.h, 0)
    expect(j.w).toBeCloseTo(280 * 0.65, 0)
    const huge = box(layoutOutfit([item('j', 'bottom', 'Jeans', 1)]), 'j')
    expect(huge.w).toBeCloseTo(190, 0)
    expect(huge.h).toBeCloseTo(190, 0)
  })
})

describe('canRenderCanvas', () => {
  it('requiere al menos una prenda de arriba o de abajo', () => {
    expect(canRenderCanvas([{ category: 'top' }])).toBe(true)
    expect(canRenderCanvas([{ category: 'bottom' }, { category: 'shoes' }])).toBe(true)
    expect(canRenderCanvas([{ category: 'shoes' }, { category: 'accessory' }])).toBe(false)
    expect(canRenderCanvas([])).toBe(false)
  })
})
