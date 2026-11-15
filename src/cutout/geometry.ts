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

/* ---------- Limpieza de la máscara (pasos puros sobre cuadrículas w×h) ---------- */

/** Curva suave 0–1 entre `low` y `high` (smoothstep). */
export function smoothstep(low: number, high: number, x: number): number {
  if (x <= low) return 0
  if (x >= high) return 1
  const t = (x - low) / (high - low)
  return t * t * (3 - 2 * t)
}

/** Suaviza un alfa 0–255 con smoothstep: lo bajo (ruido del modelo) cae a 0 y lo alto sube a 255. */
export function softenAlpha(alpha: Uint8ClampedArray, low = 0.35, high = 0.65): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round(smoothstep(low, high, v / 255) * 255)
  const out = new Uint8ClampedArray(alpha.length)
  for (let i = 0; i < alpha.length; i++) out[i] = lut[alpha[i]]
  return out
}

/** Binariza (1 si alfa >= threshold). */
export function binarize(alpha: Uint8ClampedArray, threshold = 128): Uint8Array {
  const out = new Uint8Array(alpha.length)
  for (let i = 0; i < alpha.length; i++) out[i] = alpha[i] >= threshold ? 1 : 0
  return out
}

/** Erosión o dilatación 3×3 (los bordes de la imagen se repiten, así una prenda pegada al borde no se come). */
function morph3(bin: Uint8Array, w: number, h: number, erode: boolean): Uint8Array {
  const out = new Uint8Array(bin.length)
  for (let y = 0; y < h; y++) {
    const ys = [Math.max(0, y - 1), y, Math.min(h - 1, y + 1)]
    for (let x = 0; x < w; x++) {
      const xs = [Math.max(0, x - 1), x, Math.min(w - 1, x + 1)]
      let all = 1
      let any = 0
      for (const yy of ys)
        for (const xx of xs) {
          const v = bin[yy * w + xx]
          all &= v
          any |= v
        }
      out[y * w + x] = erode ? all : any
    }
  }
  return out
}

export const erode3 = (bin: Uint8Array, w: number, h: number) => morph3(bin, w, h, true)
export const dilate3 = (bin: Uint8Array, w: number, h: number) => morph3(bin, w, h, false)
/** Apertura 3×3 (`iterations` veces): quita motas, rebabas y puentes de hasta 2·iterations px. */
export function open3(bin: Uint8Array, w: number, h: number, iterations = 1): Uint8Array {
  let out = bin
  for (let i = 0; i < iterations; i++) out = erode3(out, w, h)
  for (let i = 0; i < iterations; i++) out = dilate3(out, w, h)
  return out
}
/** Cierre 3×3: rellena agujeros de 1–2 px. */
export const close3 = (bin: Uint8Array, w: number, h: number) => erode3(dilate3(bin, w, h), w, h)

interface Labels {
  labels: Int32Array
  areas: number[]
  /** true si la componente toca el borde de la imagen. */
  touchesBorder: boolean[]
}

/** Etiqueta componentes conexas de los píxeles == `value` (iterativo, sin recursión). Etiquetas desde 0. */
function labelComponents(bin: Uint8Array, w: number, h: number, value: 0 | 1, eight: boolean): Labels {
  const labels = new Int32Array(bin.length).fill(-1)
  const stack = new Int32Array(bin.length)
  const areas: number[] = []
  const touchesBorder: boolean[] = []
  for (let start = 0; start < bin.length; start++) {
    if (bin[start] !== value || labels[start] !== -1) continue
    const id = areas.length
    let area = 0
    let border = false
    let sp = 0
    stack[sp++] = start
    labels[start] = id
    while (sp > 0) {
      const p = stack[--sp]
      area++
      const x = p % w
      const y = (p - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (bin[q] === value && labels[q] === -1) {
            labels[q] = id
            stack[sp++] = q
          }
        }
      }
    }
    areas.push(area)
    touchesBorder.push(border)
  }
  return { labels, areas, touchesBorder }
}

/** Conserva la componente más grande y las que midan al menos `minRatio` de ella; el resto (restos de gancho, motas) se borra. */
export function keepMainComponents(bin: Uint8Array, w: number, h: number, minRatio = 0.05): Uint8Array {
  const { labels, areas } = labelComponents(bin, w, h, 1, true)
  const out = new Uint8Array(bin.length)
  if (areas.length === 0) return out
  const largest = Math.max(...areas)
  const keep = areas.map((a) => a >= largest * minRatio)
  for (let i = 0; i < bin.length; i++) if (labels[i] >= 0 && keep[labels[i]]) out[i] = 1
  return out
}

/** Rellena agujeros interiores (fondo que no toca el borde) de menos de `maxArea` píxeles. */
export function fillSmallHoles(bin: Uint8Array, w: number, h: number, maxArea: number): Uint8Array {
  const { labels, areas, touchesBorder } = labelComponents(bin, w, h, 0, false)
  const out = new Uint8Array(bin)
  for (let i = 0; i < bin.length; i++) {
    const l = labels[i]
    if (l >= 0 && !touchesBorder[l] && areas[l] < maxArea) out[i] = 1
  }
  return out
}

/** Desenfoque 3×3 de una máscara binaria → alfa 0–255 con borde suavizado de ~1 px. */
export function featherMask(bin: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bin.length)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1)
    const y1 = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1)
      const x1 = Math.min(w - 1, x + 1)
      let sum = 0
      let n = 0
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) {
          sum += bin[yy * w + xx]
          n++
        }
      out[y * w + x] = Math.round((sum / n) * 255)
    }
  }
  return out
}

export interface CleanOptions {
  low?: number
  high?: number
  /** Componentes con al menos esta fracción de la más grande se conservan. */
  minComponentRatio?: number
  /** Agujeros interiores menores que esta fracción del área de la prenda se rellenan. */
  maxHoleFraction?: number
}

/**
 * Limpia un alfa 0–255 de la máscara: smoothstep → binario → apertura y cierre 3×3 → solo componentes principales
 * → rellena agujeros chicos → borde suavizado (~1 px). Devuelve alfa 0–255 (todo ceros si no queda nada).
 */
export function cleanMaskAlpha(alpha: Uint8ClampedArray, w: number, h: number, opts: CleanOptions = {}): Uint8ClampedArray {
  const { low = 0.35, high = 0.65, minComponentRatio = 0.05, maxHoleFraction = 0.004 } = opts
  let bin = binarize(softenAlpha(alpha, low, high))
  bin = close3(open3(bin, w, h, 3), w, h)
  bin = keepMainComponents(bin, w, h, minComponentRatio)
  let area = 0
  for (let i = 0; i < bin.length; i++) area += bin[i]
  if (area === 0) return new Uint8ClampedArray(bin.length)
  bin = fillSmallHoles(bin, w, h, Math.max(16, Math.round(area * maxHoleFraction)))
  return featherMask(bin, w, h)
}

/**
 * Evita el halo del fondo: en píxeles de borde (alfa parcial) reemplaza el color por el promedio de píxeles
 * opacos cercanos (anillo de 2 a 5 px; si no hay, de 1 px). Modifica `rgba` en sitio.
 */
export function decontaminateEdges(rgba: Uint8ClampedArray, alpha: Uint8ClampedArray, w: number, h: number): void {
  const OPAQUE = 250
  let partial = false
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 0 && alpha[i] < OPAQUE) {
      partial = true
      break
    }
  }
  if (!partial) return
  const src = new Uint8ClampedArray(rgba)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha[y * w + x]
      if (a === 0 || a >= OPAQUE) continue
      for (const [r0, r1] of [
        [2, 5],
        [1, 1],
      ]) {
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (let yy = Math.max(0, y - r1); yy <= Math.min(h - 1, y + r1); yy++)
          for (let xx = Math.max(0, x - r1); xx <= Math.min(w - 1, x + r1); xx++) {
            if (Math.max(Math.abs(xx - x), Math.abs(yy - y)) < r0) continue
            const q = yy * w + xx
            if (alpha[q] < OPAQUE) continue
            r += src[q * 4]
            g += src[q * 4 + 1]
            b += src[q * 4 + 2]
            n++
          }
        if (n > 0) {
          rgba[(y * w + x) * 4] = Math.round(r / n)
          rgba[(y * w + x) * 4 + 1] = Math.round(g / n)
          rgba[(y * w + x) * 4 + 2] = Math.round(b / n)
          break
        }
      }
    }
  }
}

/** Caja mínima de los píxeles con alfa > threshold en un plano de un byte por píxel; null si no hay ninguno. */
export function alphaPlaneBoundingBox(alpha: Uint8ClampedArray, w: number, h: number, threshold = 16): Rect | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > threshold) {
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

/**
 * Aplica una máscara ya en 0–255 (como la manda el worker) a una imagen RGBA y la recorta al contenido con margen.
 * La limpieza (ver `cleanMaskAlpha`) se hace a la resolución de la máscara; después el alfa se reescala a la foto.
 * La cobertura se mide con el alfa ya limpio. Devuelve null si no queda nada de prenda.
 * Memoria: se recorta primero y el alfa solo se escribe en la región recortada (no hay copia RGBA completa).
 */
export function cutoutFromAlpha(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  maskAlpha: Uint8ClampedArray,
  maskW: number,
  maskH: number,
  paddingFraction = 0.03,
): { rgba: Uint8ClampedArray; width: number; height: number; coverage: number } | null {
  const cleaned = cleanMaskAlpha(maskAlpha, maskW, maskH)
  const alpha = resizeAlpha(cleaned, maskW, maskH, w, h)
  const coverage = alphaCoverage(alpha)
  const box = alphaPlaneBoundingBox(alpha, w, h)
  if (!box) return null
  const rect = padRect(box, w, h, paddingFraction)
  const cropped = cropRgba(rgba, w, rect)
  const croppedAlpha = new Uint8ClampedArray(rect.w * rect.h)
  for (let y = 0; y < rect.h; y++) {
    const from = (rect.y + y) * w + rect.x
    croppedAlpha.set(alpha.subarray(from, from + rect.w), y * rect.w)
  }
  for (let i = 0; i < croppedAlpha.length; i++) cropped[i * 4 + 3] = croppedAlpha[i]
  decontaminateEdges(cropped, croppedAlpha, rect.w, rect.h)
  return { rgba: cropped, width: rect.w, height: rect.h, coverage }
}

/** Como `cutoutFromAlpha`, pero con la salida cruda del modelo (cualquier rango; se normaliza mín–máx). */
export function cutoutFromMask(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  mask: ArrayLike<number>,
  maskW: number,
  maskH: number,
  paddingFraction = 0.03,
) {
  return cutoutFromAlpha(rgba, w, h, maskToAlpha(mask), maskW, maskH, paddingFraction)
}
