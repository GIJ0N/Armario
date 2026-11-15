import { CUTOUT_MODEL, MIN_MASK_COVERAGE } from './modelConfig'
import { bboxToRect, cutoutFromMask, padRect, type Rect } from './geometry'
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
    const { ctx } = makeCanvas(size, size)
    ctx.drawImage(bitmap, 0, 0, size, size)
    const px = ctx.getImageData(0, 0, size, size).data
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

/** Aplica la máscara del modelo a la foto original (resolución completa), recorta al contenido y devuelve un PNG con alfa. */
export async function maskToCutoutBlob(original: Blob, mask: Float32Array, maskSize: number): Promise<Blob> {
  const bitmap = await decode(original)
  try {
    const { width: w, height: h } = bitmap
    const { ctx } = makeCanvas(w, h)
    ctx.drawImage(bitmap, 0, 0)
    const rgba = ctx.getImageData(0, 0, w, h).data
    const result = cutoutFromMask(rgba, w, h, mask, maskSize, maskSize)
    if (!result || result.coverage < MIN_MASK_COVERAGE) throw new CutoutError('empty-mask', 'El modelo no encontró la prenda en la foto.')
    const out = makeCanvas(result.width, result.height)
    out.ctx.putImageData(new ImageData(new Uint8ClampedArray(result.rgba), result.width, result.height), 0, 0)
    return await toBlob(out.canvas, 'image/png')
  } finally {
    bitmap.close()
  }
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
    return await toBlob(canvas, 'image/jpeg', 0.85)
  } finally {
    bitmap.close()
  }
}
