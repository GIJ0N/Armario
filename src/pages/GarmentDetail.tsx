import { useEffect, useState } from 'react'
import { ChevronLeft, Heart } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { GarmentForm, type GarmentFormSubmit } from '../components/GarmentForm'
import { CutoutControls } from '../components/CutoutControls'
import { useRepository } from '../components/RepositoryContext'
import { SkeletonBlock } from '../components/Skeleton'
import { useToast } from '../components/ToastProvider'
import { finishCutoutAfterSave, useBackgroundRemover } from '../cutout'
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

  async function save({ data, newPhoto, removePhoto, providedCutout }: GarmentFormSubmit) {
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
    if (newPhoto && photo_path) await finishCutoutAfterSave(repo, remover, updated, { providedCutout })
    navigate('/armario')
  }

  async function toggleFavorite() {
    try {
      const updated = await repo.setFavorite(garment!.id, !garment!.favorite)
      setGarment((cur) => (cur ? { ...cur, favorite: updated.favorite } : cur))
      toast(updated.favorite ? 'Agregada a favoritas' : 'Quitada de favoritas')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
  }

  async function markClean() {
    try {
      const updated = await repo.setStatus(garment!.id, 'active')
      setGarment(updated)
      toast('Prenda activa de nuevo')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
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
      <div className="page-head">
        <h1 className="page-title">Editar prenda</h1>
        <button
          type="button"
          className={`icon-btn fav-btn${garment.favorite ? ' fav-btn-on' : ''}`}
          aria-label={garment.favorite ? 'Quitar de favoritas' : 'Marcar como favorita'}
          aria-pressed={!!garment.favorite}
          onClick={() => void toggleFavorite()}
        >
          <Heart size={24} aria-hidden="true" fill={garment.favorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      {garment.status === 'laundry' && (
        <div className="laundry-note">
          <span className="badge badge-inline">Lavandería</span>
          <button type="button" className="btn btn-inline" onClick={() => void markClean()}>
            Ya está limpia
          </button>
        </div>
      )}
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
