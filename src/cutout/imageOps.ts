import { CUTOUT_MODEL, MIN_MASK_COVERAGE } from './modelConfig'
import { bboxToRect, cutoutFromAlpha, padRect, type Rect } from './geometry'
import { CutoutError } from './types'

/** Operaciones con canvas (navegador). La lógica numérica vive en geometry.ts. */

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    throw new CutoutError('failed', 'No se pudo leer la foto para recortarla.')
  }
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new CutoutError('failed', 'No se pudo procesar la imagen.')
  return { canvas, ctx }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new CutoutError('failed', 'No se pudo guardar el recorte.'))), type, quality),
  )
}

/** Imagen → tensor NCHW float32 normalizado (el modelo recibe el cuadrado completo, sin conservar proporción). */
export async function imageToModelInput(image: Blob): Promise<{ data: Float32Array; size: number }> {
  const size = CUTOUT_MODEL.inputSize
  const bitmap = await decode(image)
  try {
    const { canvas, ctx } = makeCanvas(size, size)
    ctx.drawImage(bitmap, 0, 0, size, size)
    const px = ctx.getImageData(0, 0, size, size).data
    release(canvas)
    const plane = size * size
    const data = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        data[c * plane + i] = (px[i * 4 + c] / 255 - CUTOUT_MODEL.mean[c]) / CUTOUT_MODEL.std[c]
      }
    }
    return { data, size }
  } finally {
    bitmap.close()
  }
}

/** Aplica la máscara (alfa 0–255 que manda el worker) a la foto original, recorta al contenido y devuelve un PNG con alfa. */
export async function maskToCutoutBlob(original: Blob, alpha: Uint8ClampedArray, maskSize: number): Promise<Blob> {
  const bitmap = await decode(original)
  let canvasToFree: HTMLCanvasElement | null = null
  let outCanvas: HTMLCanvasElement | null = null
  try {
    const { width: w, height: h } = bitmap
    const { canvas, ctx } = makeCanvas(w, h)
    canvasToFree = canvas
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    let rgba: Uint8ClampedArray | null = ctx.getImageData(0, 0, w, h).data
    // Se suelta el lienzo grande antes de armar el recorte: no coexisten la foto completa en canvas y en memoria.
    release(canvas)
    canvasToFree = null
    const result = cutoutFromAlpha(rgba, w, h, alpha, maskSize, maskSize)
    rgba = null
    if (!result || result.coverage < MIN_MASK_COVERAGE) throw new CutoutError('empty-mask', 'El modelo no encontró la prenda en la foto.')
    const out = makeCanvas(result.width, result.height)
    outCanvas = out.canvas
    out.ctx.putImageData(new ImageData(result.rgba as Uint8ClampedArray<ArrayBuffer>, result.width, result.height), 0, 0)
    return await toBlob(out.canvas, 'image/png')
  } finally {
    bitmap.close()
    if (canvasToFree) release(canvasToFree)
    if (outCanvas) release(outCanvas)
  }
}

/** Libera el búfer de píxeles de un canvas (Safari lo retiene hasta que el lienzo se recolecta). */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/** Plan B: recorta la foto original (JPEG, sin transparencia) al cuadro normalizado que propuso la IA, con margen. */
export async function cropToBBoxBlob(original: Blob, bbox: Rect): Promise<Blob> {
  const bitmap = await decode(original)
  try {
    const { width: w, height: h } = bitmap
    const rect = padRect(bboxToRect(bbox, w, h), w, h)
    const { canvas, ctx } = makeCanvas(rect.w, rect.h)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, rect.w, rect.h)
    ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
    try {
      return await toBlob(canvas, 'image/jpeg', 0.85)
    } finally {
      release(canvas)
    }
  } finally {
    bitmap.close()
  }
}
