import { useEffect, useMemo, useState } from 'react'
import { useRepository } from './RepositoryContext'

export interface GarmentImage {
  url: string
  /** Tamaño natural; null hasta que el navegador decodifica la imagen. */
  width: number | null
  height: number | null
}

/** Carga varias fotos del almacén como URLs de objeto (con su tamaño natural). La clave null se ignora. */
export function useGarmentImages(keys: (string | null | undefined)[]): Map<string, GarmentImage> {
  const repo = useRepository()
  const signature = keys.filter(Boolean).join('\n')
  const [images, setImages] = useState<Map<string, GarmentImage>>(new Map())

  useEffect(() => {
    const list = signature ? [...new Set(signature.split('\n'))] : []
    const urls: string[] = []
    let cancelled = false
    for (const key of list) {
      void repo.getPhoto(key).then((blob) => {
        if (cancelled || !blob) return
        const url = URL.createObjectURL(blob)
        urls.push(url)
        setImages((m) => new Map(m).set(key, { url, width: null, height: null }))
        const img = new Image()
        img.onload = () => {
          if (cancelled || !img.naturalWidth || !img.naturalHeight) return
          setImages((m) => new Map(m).set(key, { url, width: img.naturalWidth, height: img.naturalHeight }))
        }
        img.src = url
      })
    }
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
      setImages(new Map())
    }
  }, [repo, signature])

  return images
}

/** Una sola foto: URL de objeto y tamaño natural. */
export function useGarmentImage(path: string | null | undefined): GarmentImage | null {
  const keys = useMemo(() => [path], [path])
  return useGarmentImages(keys).get(path ?? '') ?? null
}
