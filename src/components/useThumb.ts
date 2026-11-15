import { useEffect, useState } from 'react'
import type { Repository } from '../db'
import { useRepository } from './RepositoryContext'

/** Lado mayor de las miniaturas del calendario (px); a 3x sobra para una celda de ~25 pt. */
const THUMB_EDGE = 96

type Cache = Map<string, Promise<string | null>>
const caches = new WeakMap<Repository, Cache>()
/** Las fotos se reducen de una en una: decodificar muchas a 1600 px a la vez cierra la página en iOS. */
let queue: Promise<unknown> = Promise.resolve()

async function shrink(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return blob
  try {
    const bitmap = await createImageBitmap(blob)
    const k = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * k))
    canvas.height = Math.max(1, Math.round(bitmap.height * k))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return blob
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return out ?? blob
  } catch {
    return blob
  }
}

function load(repo: Repository, key: string): Promise<string | null> {
  let cache = caches.get(repo)
  if (!cache) caches.set(repo, (cache = new Map()))
  let hit = cache.get(key)
  if (!hit) {
    const run = async () => {
      const blob = await repo.getPhoto(key)
      if (!blob) return null
      return URL.createObjectURL(await shrink(blob))
    }
    hit = queue.then(run, run).catch(() => null)
    queue = hit
    cache.set(key, hit)
  }
  return hit
}

/** URL de una miniatura reducida de la foto `key` (compartida y guardada mientras dure la sesión). null mientras carga o si no hay foto. */
export function useThumb(key: string | null | undefined): string | null {
  const repo = useRepository()
  const [state, setState] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!key) return
    let cancelled = false
    void load(repo, key).then((url) => {
      if (!cancelled && url) setState({ key, url })
    })
    return () => {
      cancelled = true
    }
  }, [repo, key])
  return key && state?.key === key ? state.url : null
}
