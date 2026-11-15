import { Shirt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRepository } from './RepositoryContext'

export function GarmentPhoto({ photoPath, alt }: { photoPath: string | null; alt: string }) {
  const repo = useRepository()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!photoPath) return
    let objectUrl: string | null = null
    let cancelled = false
    repo.getPhoto(photoPath).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [repo, photoPath])

  if (!photoPath || !url) {
    return (
      <div className="photo-placeholder" aria-hidden="true">
        <Shirt strokeWidth={1.4} />
      </div>
    )
  }
  return <img className="garment-img" src={url} alt={alt} />
}
