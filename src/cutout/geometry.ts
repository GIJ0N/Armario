/** Funciones puras (sin DOM) para aplicar la máscara y recortar al contenido. Se prueban con arreglos sintéticos. */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Lleva la salida del modelo a 0–255 (normalización mín–máx, como en el ejemplo oficial de RMBG-1.4). */
export function maskToAlpha(mask: ArrayLike<number>): Uint8ClampedArray {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]
    if (Number.isNaN(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  const out = new Uint8ClampedArray(mask.length)
  if (!Number.isFinite(min) || max - min < 1e-6) return out
  const range = max - min
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]
    out[i] = Number.isNaN(v) ? 0 : Math.round(((v - min) / range) * 255)
  }
  return out
}

/** Reescala un canal de 0–255 con interpolación bilinear (centros de píxel alineados). */
export function resizeAlpha(src: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  if (sw === dw && sh === dh) return new Uint8ClampedArray(src)
  const out = new Uint8ClampedArray(dw * dh)
  const xr = sw / dw
  const yr = sh / dh
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(Math.max((y + 0.5) * yr - 0.5, 0), sh - 1)
    const y0 = Math.floor(fy)
    const y1 = Math.min(y0 + 1, sh - 1)
    const wy = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(Math.max((x + 0.5) * xr - 0.5, 0), sw - 1)
      const x0 = Math.floor(fx)
      const x1 = Math.min(x0 + 1, sw - 1)
      const wx = fx - x0
      const top = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx
      const bottom = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx
      out[y * dw + x] = Math.round(top * (1 - wy) + bottom * wy)
    }
  }
  return out
}

/** Copia RGBA con el canal alfa reemplazado por `alpha` (un valor por píxel). */
export function applyAlpha(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray): Uint8ClampedArray {
  if (alpha.length * 4 !== rgba.length) throw new Error('La máscara no coincide con la imagen')
  const out = new Uint8ClampedArray(rgba)
  for (let i = 0; i < alpha.length; i++) out[i * 4 + 3] = alpha[i]
  return out
}

/** Fracción de píxeles con alfa por encima del umbral. */
export function alphaCoverage(alpha: Uint8ClampedArray, threshold = 16): number {
  if (alpha.length === 0) return 0
  let n = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i] > threshold) n++
  return n / alpha.length
}

/** Caja mínima de los píxeles con alfa > threshold en una imagen RGBA; null si no hay ninguno. */
export function alphaBoundingBox(rgba: Uint8ClampedArray, w: number, h: number, threshold = 16): Rect | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Agrega margen (fracción del lado largo de la caja, mínimo `minPx`) y limita al tamaño de la imagen. */
export function padRect(rect: Rect, w: number, h: number, fraction = 0.03, minPx = 4): Rect {
  const pad = Math.max(minPx, Math.round(Math.max(rect.w, rect.h) * fraction))
  const x0 = Math.max(0, rect.x - pad)
  const y0 = Math.max(0, rect.y - pad)
  const x1 = Math.min(w, rect.x + rect.w + pad)
  const y1 = Math.min(h, rect.y + rect.h + pad)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Convierte un cuadro normalizado 0–1 (x, y, w, h) en píxeles dentro de una imagen de w×h. */
export function bboxToRect(bbox: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, Math.floor(bbox.x * w))
  const y0 = Math.max(0, Math.floor(bbox.y * h))
  const x1 = Math.min(w, Math.ceil((bbox.x + bbox.w) * w))
  const y1 = Math.min(h, Math.ceil((bbox.y + bbox.h) * h))
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

/** Recorta un rectángulo de una imagen RGBA. */
export function cropRgba(rgba: Uint8ClampedArray, w: number, rect: Rect): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4)
  for (let y = 0; y < rect.h; y++) {
    const from = ((rect.y + y) * w + rect.x) * 4
    out.set(rgba.subarray(from, from + rect.w * 4), y * rect.w * 4)
  }
  return out
}

/**
 * Aplica la máscara a una imagen RGBA y la recorta al contenido con margen.
 * Devuelve null si la máscara queda vacía (nada de prenda).
 */
export function cutoutFromMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  mask: ArrayLike<number>,
  maskW: number,
  maskH: number,
  paddingFraction = 0.03,
): { rgba: Uint8ClampedArray; width: number; height: number; coverage: number } | null {
  const alpha = resizeAlpha(maskToAlpha(mask), maskW, maskH, w, h)
  const coverage = alphaCoverage(alpha)
  const masked = applyAlpha(rgba, alpha)
  const box = alphaBoundingBox(masked, w, h)
  if (!box) return null
  const rect = padRect(box, w, h, paddingFraction)
  return { rgba: cropRgba(masked, w, rect), width: rect.w, height: rect.h, coverage }
}
