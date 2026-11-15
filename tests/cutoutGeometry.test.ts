import { describe, expect, it } from 'vitest'
import {
  alphaBoundingBox,
  alphaCoverage,
  applyAlpha,
  bboxToRect,
  binarize,
  cleanMaskAlpha,
  close3,
  cropRgba,
  cutoutFromAlpha,
  cutoutFromMask,
  decontaminateEdges,
  featherMask,
  fillSmallHoles,
  keepMainComponents,
  open3,
  smoothstep,
  softenAlpha,
  maskToAlpha,
  padRect,
  resizeAlpha,
} from '../src/cutout/geometry'

/** Imagen RGBA w×h; cada píxel (x,y) = [x, y, 7, 255]. */
function image(w: number, h: number) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x, y, 7, 255], (y * w + x) * 4)
  return px
}

describe('máscara', () => {
  it('maskToAlpha normaliza mín–máx a 0–255 y trata NaN/constante como vacío', () => {
    expect(Array.from(maskToAlpha([-2, 0, 2]))).toEqual([0, 128, 255])
    expect(Array.from(maskToAlpha([0.3, 0.3]))).toEqual([0, 0])
    expect(Array.from(maskToAlpha([NaN, 0, 1]))).toEqual([0, 0, 255])
  })

  it('resizeAlpha conserva el tamaño o interpola', () => {
    const a = new Uint8ClampedArray([0, 255, 255, 0])
    expect(Array.from(resizeAlpha(a, 2, 2, 2, 2))).toEqual([0, 255, 255, 0])
    const big = resizeAlpha(new Uint8ClampedArray([0, 255]), 2, 1, 4, 1)
    expect(big[0]).toBe(0)
    expect(big[3]).toBe(255)
    expect(big[1]).toBeGreaterThan(0)
    expect(big[1]).toBeLessThan(big[2])
  })

  it('applyAlpha reemplaza solo el canal alfa y valida tamaños', () => {
    const rgba = image(2, 1)
    const out = applyAlpha(rgba, new Uint8ClampedArray([10, 20]))
    expect(Array.from(out)).toEqual([0, 0, 7, 10, 1, 0, 7, 20])
    expect(rgba[3]).toBe(255)
    expect(() => applyAlpha(rgba, new Uint8ClampedArray(3))).toThrow()
  })

  it('alphaCoverage mide la fracción de píxeles visibles', () => {
    expect(alphaCoverage(new Uint8ClampedArray([0, 0, 255, 255]))).toBe(0.5)
    expect(alphaCoverage(new Uint8ClampedArray([]))).toBe(0)
  })
})

describe('caja y recorte', () => {
  it('alphaBoundingBox encuentra la caja mínima y devuelve null si no hay nada', () => {
    const w = 6
    const h = 5
    const px = new Uint8ClampedArray(w * h * 4)
    for (const [x, y] of [[2, 1], [4, 3], [3, 2]]) px[(y * w + x) * 4 + 3] = 255
    expect(alphaBoundingBox(px, w, h)).toEqual({ x: 2, y: 1, w: 3, h: 3 })
    px[(1 * w + 2) * 4 + 3] = 10 // bajo el umbral
    expect(alphaBoundingBox(px, w, h)).toEqual({ x: 3, y: 2, w: 2, h: 2 })
    expect(alphaBoundingBox(new Uint8ClampedArray(w * h * 4), w, h)).toBeNull()
  })

  it('padRect agrega margen y respeta los bordes de la imagen', () => {
    expect(padRect({ x: 40, y: 40, w: 100, h: 50 }, 400, 400, 0.05)).toEqual({ x: 35, y: 35, w: 110, h: 60 })
    expect(padRect({ x: 1, y: 1, w: 10, h: 10 }, 12, 12, 0.5, 4)).toEqual({ x: 0, y: 0, w: 12, h: 12 })
    // margen mínimo en píxeles
    expect(padRect({ x: 10, y: 10, w: 10, h: 10 }, 100, 100, 0.01, 4)).toEqual({ x: 6, y: 6, w: 18, h: 18 })
  })

  it('bboxToRect pasa de 0–1 a píxeles dentro de la imagen', () => {
    expect(bboxToRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 200, 100)).toEqual({ x: 50, y: 50, w: 100, h: 25 })
    expect(bboxToRect({ x: 0, y: 0, w: 1, h: 1 }, 20, 10)).toEqual({ x: 0, y: 0, w: 20, h: 10 })
  })

  it('cropRgba copia el rectángulo', () => {
    const out = cropRgba(image(5, 4), 5, { x: 1, y: 2, w: 2, h: 2 })
    expect(Array.from(out)).toEqual([1, 2, 7, 255, 2, 2, 7, 255, 1, 3, 7, 255, 2, 3, 7, 255])
  })

  it('cutoutFromMask: aplica la máscara y recorta al contenido con margen', () => {
    const w = 40
    const h = 40
    const mask = new Float32Array(w * h)
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) mask[y * w + x] = 1
    const result = cutoutFromMask(image(w, h), w, h, mask, w, h, 0)
    expect(result).not.toBeNull()
    // Bloque 8×8 + borde suavizado de 1 px = 10×10, más margen mínimo de 4 px por lado = 18×18.
    expect(result!.width).toBe(18)
    expect(result!.height).toBe(18)
    expect(alphaBoundingBox(result!.rgba, 18, 18)).toEqual({ x: 4, y: 4, w: 10, h: 10 })
    expect(result!.coverage).toBeGreaterThanOrEqual(64 / 1600)
    expect(result!.coverage).toBeLessThanOrEqual(100 / 1600)
    expect(result!.rgba[3]).toBe(0) // fuera de la prenda: transparente
    const i = (7 * 18 + 7) * 4 // píxel interior de la prenda: (14,14) en la imagen original
    expect(Array.from(result!.rgba.slice(i, i + 4))).toEqual([14, 14, 7, 255])
  })

  it('cutoutFromMask admite una máscara de otra resolución que la foto', () => {
    const mask = new Float32Array(256)
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) mask[y * 16 + x] = 1 // bloque central de una máscara 16×16
    const result = cutoutFromMask(image(40, 40), 40, 40, mask, 16, 16, 0)
    expect(result).not.toBeNull()
    expect(result!.coverage).toBeGreaterThan(0.2)
    expect(result!.coverage).toBeLessThan(0.7)
  })

  it('cutoutFromMask devuelve null con máscara vacía', () => {
    expect(cutoutFromMask(image(4, 4), 4, 4, new Float32Array(16), 4, 4)).toBeNull()
  })
})

/** Cuadrícula binaria w×h con rectángulos rellenos [x0,y0,x1,y1) (x1,y1 exclusivos). */
function grid(w: number, h: number, rects: number[][]) {
  const g = new Uint8Array(w * h)
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g[y * w + x] = 1
  return g
}
const sum = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0)
const at = (g: ArrayLike<number>, w: number, x: number, y: number) => g[y * w + x]

describe('limpieza de la máscara', () => {
  it('smoothstep y softenAlpha: bajo el umbral 0, sobre el alto 255, curva suave entre ambos', () => {
    expect(smoothstep(0.35, 0.65, 0.2)).toBe(0)
    expect(smoothstep(0.35, 0.65, 0.9)).toBe(1)
    expect(smoothstep(0.35, 0.65, 0.5)).toBeCloseTo(0.5)
    const out = softenAlpha(new Uint8ClampedArray([0, 60, 128, 200, 255]))
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0) // ruido bajo
    expect(out[2]).toBeGreaterThan(110)
    expect(out[2]).toBeLessThan(145)
    expect(out[3]).toBe(255)
    expect(out[4]).toBe(255)
  })

  it('binarize usa el umbral', () => {
    expect(Array.from(binarize(new Uint8ClampedArray([0, 127, 128, 255])))).toEqual([0, 0, 1, 1])
  })

  it('open3 quita una mota aislada y conserva el bloque; close3 rellena un agujero de 1 px', () => {
    const w = 20
    const g = grid(w, 20, [[6, 6, 14, 14], [1, 1, 2, 2]])
    const opened = open3(g, w, 20)
    expect(at(opened, w, 1, 1)).toBe(0)
    expect(sum(opened)).toBe(64)
    const holed = grid(w, 20, [[6, 6, 14, 14]])
    holed[10 * w + 10] = 0
    const closed = close3(holed, w, 20)
    expect(at(closed, w, 10, 10)).toBe(1)
  })

  it('open3 con varias iteraciones quita rebabas más gruesas pero conserva la prenda', () => {
    const w = 40
    const g = grid(w, 40, [[10, 10, 30, 30], [2, 2, 7, 7]]) // prenda 20×20 y mota 5×5
    expect(at(open3(g, w, 40, 1), w, 4, 4)).toBe(1)
    const out = open3(g, w, 40, 3)
    expect(at(out, w, 4, 4)).toBe(0)
    expect(at(out, w, 20, 20)).toBe(1)
    expect(sum(out)).toBe(400)
  })

  it('keepMainComponents: quita motas y restos pequeños, conserva el mayor y otro grande', () => {
    const w = 60
    const g = grid(w, 60, [
      [5, 5, 35, 35], // 900 px: la mayor
      [40, 40, 58, 58], // 324 px (36 % de la mayor): se conserva
      [45, 5, 52, 12], // 49 px (5.4 %): se conserva justo por encima del 5 %
      [55, 2, 58, 4], // 6 px: mota
    ])
    const out = keepMainComponents(g, w, 60, 0.05)
    expect(at(out, w, 10, 10)).toBe(1)
    expect(at(out, w, 50, 50)).toBe(1)
    expect(at(out, w, 48, 8)).toBe(1)
    expect(at(out, w, 56, 3)).toBe(0)
    expect(sum(out)).toBe(900 + 324 + 49)
    // con un umbral mayor también cae el pequeño
    expect(at(keepMainComponents(g, w, 60, 0.1), w, 48, 8)).toBe(0)
  })

  it('keepMainComponents con una máscara vacía devuelve ceros', () => {
    expect(sum(keepMainComponents(new Uint8Array(100), 10, 10))).toBe(0)
  })

  it('fillSmallHoles rellena agujeros interiores chicos pero no los grandes ni el fondo abierto', () => {
    const w = 30
    const g = grid(w, 30, [[2, 2, 28, 28]])
    for (const [x, y] of [[8, 8], [9, 8], [8, 9], [9, 9]]) g[y * w + x] = 0 // agujero 2×2
    for (let y = 15; y < 23; y++) for (let x = 15; x < 23; x++) g[y * w + x] = 0 // agujero 8×8
    const out = fillSmallHoles(g, w, 30, 16)
    expect(at(out, w, 8, 8)).toBe(1)
    expect(at(out, w, 18, 18)).toBe(0)
    expect(at(out, w, 0, 0)).toBe(0) // fondo exterior intacto
    // un hueco abierto al borde (entre piernas) no es un agujero
    const open = grid(w, 30, [[2, 2, 14, 28], [16, 2, 28, 28], [14, 2, 16, 10]])
    expect(at(fillSmallHoles(open, w, 30, 1000), w, 15, 20)).toBe(0)
  })

  it('featherMask suaviza el borde ~1 px y deja el interior opaco', () => {
    const w = 12
    const a = featherMask(grid(w, 12, [[3, 3, 9, 9]]), w, 12)
    expect(at(a, w, 6, 6)).toBe(255)
    expect(at(a, w, 3, 6)).toBeGreaterThan(100)
    expect(at(a, w, 3, 6)).toBeLessThan(255)
    expect(at(a, w, 2, 6)).toBeGreaterThan(0)
    expect(at(a, w, 2, 6)).toBeLessThan(128)
    expect(at(a, w, 0, 0)).toBe(0)
  })

  it('cleanMaskAlpha: quita ruido y restos, conserva dos prendas grandes y rellena agujeros', () => {
    const w = 80
    const h = 80
    const bin = grid(w, h, [[10, 10, 40, 60], [45, 10, 70, 60], [72, 70, 75, 73], [41, 5, 44, 8]])
    bin[30 * w + 20] = 0 // agujero de 1 px dentro de la prenda
    const alpha = new Uint8ClampedArray(w * h)
    for (let i = 0; i < alpha.length; i++) alpha[i] = bin[i] ? 235 : 0
    for (let i = 0; i < 40; i++) alpha[(i * 37 + 11) % alpha.length] ||= 150 // pimienta
    const out = cleanMaskAlpha(alpha, w, h)
    expect(at(out, w, 20, 30)).toBe(255) // agujero rellenado
    expect(at(out, w, 25, 25)).toBe(255)
    expect(at(out, w, 60, 40)).toBe(255) // segunda componente grande
    expect(at(out, w, 73, 71)).toBe(0) // mota
    expect(at(out, w, 42, 6)).toBe(0) // resto de gancho
    expect(at(out, w, 0, 0)).toBe(0)
  })

  it('cleanMaskAlpha devuelve ceros si todo es ruido bajo', () => {
    const out = cleanMaskAlpha(new Uint8ClampedArray(100).fill(50), 10, 10)
    expect(sum(out)).toBe(0)
  })

  it('decontaminateEdges reemplaza el color del borde por el de la prenda cercana', () => {
    const w = 12
    const rgba = new Uint8ClampedArray(w * 12 * 4)
    const alpha = new Uint8ClampedArray(w * 12)
    for (let y = 0; y < 12; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const inside = x >= 4
        alpha[i] = x === 3 ? 120 : inside ? 255 : 0
        rgba.set(x === 3 ? [250, 250, 250, 120] : inside ? [10, 20, 30, 255] : [255, 255, 255, 0], i * 4)
      }
    decontaminateEdges(rgba, alpha, w, 12)
    const e = (6 * w + 3) * 4
    expect(Array.from(rgba.slice(e, e + 3))).toEqual([10, 20, 30])
    expect(rgba[e + 3]).toBe(120)
  })

  it('cutoutFromMask: el ruido y los restos no entran en la caja ni en la cobertura', () => {
    const w = 100
    const h = 100
    const mask = new Float32Array(w * h)
    for (let y = 30; y < 80; y++) for (let x = 30; x < 60; x++) mask[y * w + x] = 1 // prenda 30×50
    for (let y = 2; y < 8; y++) for (let x = 85; x < 95; x++) mask[y * w + x] = 1 // resto flotante
    mask[50 * w + 80] = 1 // mota
    const result = cutoutFromMask(image(w, h), w, h, mask, w, h, 0)!
    const box = alphaBoundingBox(result.rgba, result.width, result.height)!
    expect(box.w).toBeLessThanOrEqual(32)
    expect(box.h).toBeLessThanOrEqual(52)
    expect(result.coverage).toBeGreaterThan(1500 / 10000)
    expect(result.coverage).toBeLessThan(1700 / 10000)
  })

  it('cutoutFromMask devuelve null si la máscara solo tiene motas', () => {
    const mask = new Float32Array(400)
    mask[5 * 20 + 5] = 1
    mask[15 * 20 + 10] = 1
    expect(cutoutFromMask(image(20, 20), 20, 20, mask, 20, 20)).toBeNull()
  })
})

describe('cutoutFromAlpha (alfa en bytes, como lo manda el worker)', () => {
  it('da lo mismo que cutoutFromMask con la salida cruda', () => {
    const w = 20
    const h = 20
    const mask = new Float32Array(w * h)
    for (let y = 5; y < 15; y++) for (let x = 4; x < 16; x++) mask[y * w + x] = 1
    const a = cutoutFromMask(image(w, h), w, h, mask, w, h, 0)!
    const b = cutoutFromAlpha(image(w, h), w, h, maskToAlpha(mask), w, h, 0)!
    expect(b.width).toBe(a.width)
    expect(b.height).toBe(a.height)
    expect(Array.from(b.rgba)).toEqual(Array.from(a.rgba))
  })

  it('no modifica la imagen de entrada y omite decontaminar si no hay bordes parciales', () => {
    const w = 40
    const h = 40
    const rgba = image(w, h)
    const before = Array.from(rgba)
    const alpha = new Uint8ClampedArray(w * h)
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) alpha[y * w + x] = 255
    const out = cutoutFromAlpha(rgba, w, h, alpha, w, h, 0)!
    expect(Array.from(rgba)).toEqual(before)
    expect(out.width).toBeLessThanOrEqual(w)
  })
})
