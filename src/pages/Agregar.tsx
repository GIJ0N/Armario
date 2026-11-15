import { useNavigate } from 'react-router-dom'
import { GarmentForm, type GarmentFormSubmit } from '../components/GarmentForm'
import { useRepository } from '../components/RepositoryContext'

export default function AgregarPage() {
  const repo = useRepository()
  const navigate = useNavigate()

  async function save({ data, newPhoto }: GarmentFormSubmit) {
    const photo_path = newPhoto ? await repo.savePhoto(newPhoto) : null
    try {
      await repo.create({ ...data, photo_path })
    } catch (e) {
      if (photo_path) await repo.deletePhoto(photo_path)
      throw e
    }
    navigate('/armario')
  }

  return (
    <section>
      <h1 className="page-title">Agregar</h1>
      <GarmentForm submitLabel="Guardar prenda" onSubmit={save} />
    </section>
  )
}
