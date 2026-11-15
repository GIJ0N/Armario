import { alphaBoundingBox, padRect, type Rect } from './geometry'

/** Lógica pura (sin DOM) para reconocer una imagen que ya viene recortada (PNG/WebP con transparencia, p. ej. de Fotos o Archivos del iPhone). */

/** Un píxel cuenta como transparente con alfa por debajo de este valor. */
export const ALPHA_THRESHOLD = 16
/** Mínimo de píxeles transparentes (fracción de la imagen) para considerar que trae fondo quitado. */
export const MIN_TRANSPARENT_SHARE = 0.02
/** Mínimo de píxeles con contenido (fracción de la imagen) para que no sea una imagen casi vacía. */
export const MIN_OPAQUE_SHARE = 0.01
/** Margen alrededor del contenido al recortar. */
export const PROVIDED_PADDING = 0.03

export interface AlphaShares {
  transparent: number
  opaque: number
}

export function alphaShares(rgba: Uint8ClampedArray, w: number, h: number): AlphaShares {
  const total = w * h
  if (total <= 0 || rgba.length < total * 4) return { transparent: 0, opaque: 0 }
  let transparent = 0
  for (let i = 3; i < total * 4; i += 4) if (rgba[i] < ALPHA_THRESHOLD) transparent++
  return { transparent: transparent / total, opaque: (total - transparent) / total }
}

/** ≥ 2 % de píxeles transparentes y ≥ 1 % con contenido. */
export function hasMeaningfulAlpha(rgba: Uint8ClampedArray, w: number, h: number): boolean {
  const s = alphaShares(rgba, w, h)
  return s.transparent >= MIN_TRANSPARENT_SHARE && s.opaque >= MIN_OPAQUE_SHARE
}

/** Caja del contenido con ~3 % de margen; null si no hay contenido. */
export function providedCutoutBounds(rgba: Uint8ClampedArray, w: number, h: number): Rect | null {
  const box = alphaBoundingBox(rgba, w, h, ALPHA_THRESHOLD)
  return box ? padRect(box, w, h, PROVIDED_PADDING) : null
}
