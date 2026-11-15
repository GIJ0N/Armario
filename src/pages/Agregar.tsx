import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GarmentForm, type GarmentFormSubmit } from '../components/GarmentForm'
import { useRepository } from '../components/RepositoryContext'
import { useToast } from '../components/ToastProvider'
import { useAiTagging } from '../components/useAiTagging'
import { finishCutoutAfterSave, useBackgroundRemover } from '../cutout'

/** Una foto de la cola: tiene su propio estado de IA, así que cada foto se etiqueta de a una. */
function PhotoReview({
  file,
  position,
  total,
  onSaved,
  onSkip,
}: {
  file: File
  position: number
  total: number
  onSaved: () => void
  onSkip: () => void
}) {
  const repo = useRepository()
  const remover = useBackgroundRemover()
  const { onPhotoChange, suggestion, aiSlot } = useAiTagging()

  async function save({ data, newPhoto, providedCutout }: GarmentFormSubmit) {
    const photo_path = newPhoto ? await repo.savePhoto(newPhoto) : null
    let garment
    try {
      garment = await repo.create({ ...data, photo_path })
    } catch (e) {
      if (photo_path) await repo.deletePhoto(photo_path)
      throw e
    }
    // Recorte sin fondo en segundo plano: no bloquea el guardado ni la cola.
    if (photo_path) await finishCutoutAfterSave(repo, remover, garment, { providedCutout, bbox: suggestion?.values.bbox })
    onSaved()
  }

  return (
    <>
      <div className="queue-head">
        <p className="queue-progress" data-testid="queue-progress">
          Foto {position} de {total}
        </p>
        <button type="button" className="btn btn-quiet btn-inline" onClick={onSkip}>
          Omitir esta foto
        </button>
      </div>
      <div className="queue-bar" aria-hidden="true">
        <span style={{ width: `${((position - 1) / total) * 100}%` }} />
      </div>
      <GarmentForm
        submitLabel="Guardar prenda"
        onSubmit={save}
        onPhotoChange={onPhotoChange}
        suggestion={suggestion}
        aiSlot={aiSlot}
        initialFile={file}
      />
    </>
  )
}

export default function AgregarPage() {
  const repo = useRepository()
  const navigate = useNavigate()
  const toast = useToast()
  const remover = useBackgroundRemover()
  const { onPhotoChange, suggestion, aiSlot } = useAiTagging()
  const [queue, setQueue] = useState<File[] | null>(null)
  const [index, setIndex] = useState(0)
  const [savedCount, setSavedCount] = useState(0)

  async function save({ data, newPhoto, providedCutout }: GarmentFormSubmit) {
    const photo_path = newPhoto ? await repo.savePhoto(newPhoto) : null
    let garment
    try {
      garment = await repo.create({ ...data, photo_path })
    } catch (e) {
      if (photo_path) await repo.deletePhoto(photo_path)
      throw e
    }
    if (photo_path) await finishCutoutAfterSave(repo, remover, garment, { providedCutout, bbox: suggestion?.values.bbox })
    toast('Prenda guardada')
    navigate('/armario')
  }

  function advance(saved: boolean) {
    if (!queue) return
    const total = savedCount + (saved ? 1 : 0)
    if (index + 1 >= queue.length) {
      if (total > 0) toast(total === 1 ? 'Prenda guardada' : `${total} prendas guardadas`)
      navigate('/armario')
      return
    }
    if (saved) toast('Prenda guardada')
    setSavedCount(total)
    setIndex(index + 1)
  }

  return (
    <section>
      <h1 className="page-title">Agregar</h1>
      {queue ? (
        <PhotoReview
          key={index}
          file={queue[index]}
          position={index + 1}
          total={queue.length}
          onSaved={() => advance(true)}
          onSkip={() => advance(false)}
        />
      ) : (
        <GarmentForm
          submitLabel="Guardar prenda"
          onSubmit={save}
          onPhotoChange={onPhotoChange}
          suggestion={suggestion}
          aiSlot={aiSlot}
          onPickFiles={(files) => {
            setQueue(files)
            setIndex(0)
            setSavedCount(0)
          }}
        />
      )}
    </section>
  )
}
