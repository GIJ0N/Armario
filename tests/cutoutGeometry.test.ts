import { describe, expect, it } from 'vitest'
import {
  alphaBoundingBox,
  alphaCoverage,
  applyAlpha,
  bboxToRect,
  cropRgba,
  cutoutFromMask,
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
    const w = 20
    const h = 20
    const mask = new Float32Array(w * h)
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) mask[y * w + x] = 1
    const result = cutoutFromMask(image(w, h), w, h, mask, w, h, 0)
    expect(result).not.toBeNull()
    // Bloque 4×4 + margen mínimo de 4 px por lado = 12×12, que empieza en (4,4).
    expect(result!.width).toBe(12)
    expect(result!.height).toBe(12)
    expect(alphaBoundingBox(result!.rgba, 12, 12)).toEqual({ x: 4, y: 4, w: 4, h: 4 })
    expect(result!.coverage).toBeCloseTo(16 / 400)
    expect(result!.rgba[3]).toBe(0) // fuera de la prenda: transparente
    const i = (4 * 12 + 4) * 4 // primer píxel de la prenda: (8,8) en la imagen original
    expect(Array.from(result!.rgba.slice(i, i + 4))).toEqual([8, 8, 7, 255])
  })

  it('cutoutFromMask admite una máscara de otra resolución que la foto', () => {
    const mask = new Float32Array(16)
    for (const i of [5, 6, 9, 10]) mask[i] = 1 // bloque central de una máscara 4×4
    const result = cutoutFromMask(image(40, 40), 40, 40, mask, 4, 4, 0)
    expect(result).not.toBeNull()
    expect(result!.coverage).toBeGreaterThan(0.2)
    expect(result!.coverage).toBeLessThan(0.6)
  })

  it('cutoutFromMask devuelve null con máscara vacía', () => {
    expect(cutoutFromMask(image(4, 4), 4, 4, new Float32Array(16), 4, 4)).toBeNull()
  })
})
