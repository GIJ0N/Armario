/** Pegamento con canvas (navegador) para el recorte provisto. La lógica numérica vive en providedAlpha.ts. */

export interface DecodedRgba {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

/** Decodifica una imagen a RGBA, reduciéndola a `maxEdge` px de lado largo. Devuelve null si no se puede leer. */
export async function decodeRgba(blob: Blob, maxEdge: number): Promise<DecodedRgba | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    return { width, height, rgba: ctx.getImageData(0, 0, width, height).data }
  } catch {
    return null
  } finally {
    bitmap.close()
  }
}

export async function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo procesar la imagen.')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('No se pudo procesar la imagen.')
  return blob
}
