import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { GarmentForm, type GarmentFormSubmit } from '../components/GarmentForm'
import { CutoutControls } from '../components/CutoutControls'
import { useRepository } from '../components/RepositoryContext'
import { SkeletonBlock } from '../components/Skeleton'
import { useToast } from '../components/ToastProvider'
import { queueCutout, useBackgroundRemover } from '../cutout'
import type { Garment } from '../db'

export default function GarmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const repo = useRepository()
  const navigate = useNavigate()
  const toast = useToast()
  const remover = useBackgroundRemover()
  const [garment, setGarment] = useState<Garment | null | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void repo.get(id ?? '').then((g) => !cancelled && setGarment(g))
    return () => {
      cancelled = true
    }
  }, [repo, id])

  if (garment === undefined) return <SkeletonBlock height={340} />
  if (garment === null) {
    return (
      <section>
        <h1 className="page-title">Prenda no encontrada</h1>
        <Link to="/armario">Volver al armario</Link>
      </section>
    )
  }

  async function save({ data, newPhoto, removePhoto }: GarmentFormSubmit) {
    let photo_path = data.photo_path
    if (newPhoto) photo_path = await repo.savePhoto(newPhoto)
    else if (removePhoto) photo_path = null
    let updated
    try {
      updated = await repo.update(garment!.id, { ...data, photo_path })
    } catch (e) {
      if (newPhoto && photo_path) await repo.deletePhoto(photo_path)
      throw e
    }
    toast('Cambios guardados')
    // La foto nueva invalida el recorte anterior: se rehace en segundo plano.
    if (newPhoto && photo_path) void queueCutout(repo, remover, updated)
    navigate('/armario')
  }

  async function remove() {
    try {
      await repo.delete(garment!.id)
      toast('Prenda eliminada')
      navigate('/armario')
    } catch (e) {
      setConfirming(false)
      setError(e instanceof Error ? e.message : 'No se pudo eliminar.')
    }
  }

  return (
    <section>
      <p>
        <Link to="/armario" className="back-link">
          <ChevronLeft size={18} aria-hidden="true" />
          Armario
        </Link>
      </p>
      <h1 className="page-title">Editar prenda</h1>
      {garment.photo_path && <CutoutControls garment={garment} onChange={setGarment} />}
      <GarmentForm initial={garment} submitLabel="Guardar cambios" onSubmit={save} />
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="button" className="btn btn-danger btn-block" onClick={() => setConfirming(true)}>
        Eliminar prenda
      </button>
      {confirming && (
        <ConfirmDialog
          title="¿Eliminar esta prenda?"
          message="Se borrará la prenda y su foto. Esta acción no se puede deshacer."
          confirmLabel="Eliminar"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  )
}
