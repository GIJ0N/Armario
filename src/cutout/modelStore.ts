import { CUTOUT_MODEL, MODEL_CACHE_NAME } from './modelConfig'
import { ORT_WASM_URL, ORT_WEBGPU_WASM_URL } from './runtimeAssets'
import { webGpuAvailable } from './enginePref'
import { CutoutError, type DownloadProgress } from './types'

/** Los pesos viven en Cache Storage: descarga única, disponible sin conexión después. */

function cacheApi(): CacheStorage | null {
  return typeof caches === 'undefined' ? null : caches
}

export async function isModelCached(): Promise<boolean> {
  const api = cacheApi()
  if (!api) return false
  try {
    return !!(await (await api.open(MODEL_CACHE_NAME)).match(CUTOUT_MODEL.url))
  } catch {
    return false
  }
}

/** Tamaño guardado en bytes (para mostrarlo en Ajustes); null si no hay modelo. */
export async function cachedModelBytes(): Promise<number | null> {
  const api = cacheApi()
  if (!api) return null
  try {
    const res = await (await api.open(MODEL_CACHE_NAME)).match(CUTOUT_MODEL.url)
    if (!res) return null
    return Number(res.headers.get('content-length')) || (await res.clone().blob()).size
  } catch {
    return null
  }
}

/** Borra los pesos guardados (p. ej. para volver a descargarlos si quedaron dañados). */
export async function removeCachedModel(): Promise<void> {
  const api = cacheApi()
  if (api) await api.delete(MODEL_CACHE_NAME)
}

/** Descarga los pesos con avance y solo los guarda si llegaron completos. */
export async function downloadModel(onProgress?: (p: DownloadProgress) => void, signal?: AbortSignal): Promise<void> {
  const api = cacheApi()
  if (!api) throw new CutoutError('failed', 'Este navegador no permite guardar el modelo para usarlo sin conexión.')
  let res: Response
  try {
    res = await fetch(CUTOUT_MODEL.url, { mode: 'cors', signal })
  } catch {
    throw new CutoutError('failed', 'No se pudo descargar el modelo. Revisa tu conexión e inténtalo de nuevo.')
  }
  if (!res.ok || !res.body) {
    throw new CutoutError('failed', `No se pudo descargar el modelo (error ${res.status}). Inténtalo más tarde.`)
  }
  const declared = Number(res.headers.get('content-length')) || 0
  const total = declared || CUTOUT_MODEL.approxBytes
  const reader = res.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let loaded = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
      loaded += value.byteLength
      onProgress?.({ loaded, total, fraction: Math.min(1, loaded / total) })
    }
  } catch {
    throw new CutoutError('failed', 'Se interrumpió la descarga del modelo. Inténtalo de nuevo.')
  }
  if (loaded < CUTOUT_MODEL.minBytes || (declared && loaded < declared)) {
    throw new CutoutError('failed', 'La descarga del modelo quedó incompleta. Inténtalo de nuevo.')
  }
  const blob = new Blob(chunks, { type: 'application/octet-stream' })
  const headers = { 'content-type': 'application/octet-stream', 'content-length': String(loaded) }
  await (await api.open(MODEL_CACHE_NAME)).put(CUTOUT_MODEL.url, new Response(blob, { headers }))
  onProgress?.({ loaded, total: loaded, fraction: 1 })
}

/** Lee los pesos guardados; null si no están. */
export async function readCachedModel(): Promise<ArrayBuffer | null> {
  const api = cacheApi()
  if (!api) return null
  const res = await (await api.open(MODEL_CACHE_NAME)).match(CUTOUT_MODEL.url)
  return res ? res.arrayBuffer() : null
}

/**
 * Pide los .wasm del runtime desde la página para que el service worker los guarde (CacheFirst) y sirvan sin conexión.
 * Falla en silencio: si no hay red, el runtime se descargará al primer uso.
 */
export async function prefetchRuntime(preference: 'auto' | 'wasm'): Promise<void> {
  const urls = [ORT_WASM_URL]
  if (preference === 'auto' && webGpuAvailable()) urls.push(ORT_WEBGPU_WASM_URL)
  await Promise.all(
    urls.map((u) =>
      fetch(u)
        .then((r) => r.arrayBuffer())
        .catch(() => undefined),
    ),
  )
}
