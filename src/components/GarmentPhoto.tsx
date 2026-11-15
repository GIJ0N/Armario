import { Shirt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRepository } from './RepositoryContext'

interface Props {
  photoPath: string | null
  alt: string
  /** Recorte sin fondo; si existe se muestra en lugar de la foto original (salvo variant="original"). */
  cutoutPath?: string | null
  variant?: 'cutout' | 'original'
}

export function GarmentPhoto({ photoPath, alt, cutoutPath = null, variant = 'cutout' }: Props) {
  const repo = useRepository()
  const [url, setUrl] = useState<string | null>(null)
  const showCutout = variant === 'cutout' && !!cutoutPath
  const key = showCutout ? cutoutPath : photoPath

  useEffect(() => {
    if (!key) return
    let objectUrl: string | null = null
    let cancelled = false
    repo.getPhoto(key).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [repo, key])

  if (!key || !url) {
    return (
      <div className="photo-placeholder" aria-hidden="true">
        <Shirt strokeWidth={1.4} />
      </div>
    )
  }
  return <img className={showCutout ? 'garment-img garment-img-cutout' : 'garment-img'} src={url} alt={alt} />
}
