import { describe, expect, it } from 'vitest'
import {
  ALPHA_THRESHOLD,
  alphaShares,
  hasMeaningfulAlpha,
  providedCutoutBounds,
} from '../src/cutout/providedAlpha'

/** RGBA sintético de w×h: `alphaAt(x, y)` decide el alfa de cada píxel. */
function image(w: number, h: number, alphaAt: (x: number, y: number) => number) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      rgba[i] = 200
      rgba[i + 1] = 30
      rgba[i + 2] = 30
      rgba[i + 3] = alphaAt(x, y)
    }
  return rgba
}

describe('hasMeaningfulAlpha', () => {
  it('una imagen opaca no cuenta', () => {
    expect(hasMeaningfulAlpha(image(50, 50, () => 255), 50, 50)).toBe(false)
  })

  it('prenda sobre fondo transparente cuenta', () => {
    const rgba = image(100, 100, (x, y) => (x >= 20 && x < 80 && y >= 10 && y < 90 ? 255 : 0))
    expect(hasMeaningfulAlpha(rgba, 100, 100)).toBe(true)
  })

  it('umbral de transparencia: 2 % cuenta, 1 % no', () => {
    // 100×100: las primeras N filas de 100 px son transparentes → N % de la imagen.
    const withRows = (n: number) => image(100, 100, (_x, y) => (y < n ? 0 : 255))
    expect(hasMeaningfulAlpha(withRows(2), 100, 100)).toBe(true)
    expect(hasMeaningfulAlpha(withRows(1), 100, 100)).toBe(false)
  })

  it('umbral de contenido: casi todo transparente con menos de 1 % de contenido no cuenta', () => {
    const tiny = image(100, 100, (x, y) => (x < 9 && y < 10 ? 255 : 0)) // 0.9 %
    const enough = image(100, 100, (x, y) => (x < 10 && y < 10 ? 255 : 0)) // 1 %
    expect(hasMeaningfulAlpha(tiny, 100, 100)).toBe(false)
    expect(hasMeaningfulAlpha(enough, 100, 100)).toBe(true)
    expect(hasMeaningfulAlpha(image(10, 10, () => 0), 10, 10)).toBe(false)
  })

  it('alfa justo por debajo del umbral cuenta como transparente', () => {
    const rgba = image(10, 10, (x) => (x < 5 ? ALPHA_THRESHOLD - 1 : ALPHA_THRESHOLD))
    expect(alphaShares(rgba, 10, 10)).toEqual({ transparent: 0.5, opaque: 0.5 })
  })

  it('tamaños inconsistentes o vacíos no cuentan', () => {
    expect(hasMeaningfulAlpha(new Uint8ClampedArray(0), 0, 0)).toBe(false)
    expect(hasMeaningfulAlpha(new Uint8ClampedArray(8), 10, 10)).toBe(false)
  })
})

describe('providedCutoutBounds', () => {
  it('caja del contenido con ~3 % de margen (mínimo 4 px) limitada a la imagen', () => {
    const rgba = image(200, 200, (x, y) => (x >= 50 && x < 150 && y >= 40 && y < 160 ? 255 : 0))
    // contenido 100×120 → margen max(4, round(120×0.03)=4)
    expect(providedCutoutBounds(rgba, 200, 200)).toEqual({ x: 46, y: 36, w: 108, h: 128 })
  })

  it('no sale de la imagen cuando el contenido toca el borde', () => {
    const rgba = image(100, 100, (x) => (x < 50 ? 255 : 0))
    expect(providedCutoutBounds(rgba, 100, 100)).toEqual({ x: 0, y: 0, w: 54, h: 100 })
  })

  it('sin contenido devuelve null', () => {
    expect(providedCutoutBounds(image(10, 10, () => 0), 10, 10)).toBeNull()
  })
})
