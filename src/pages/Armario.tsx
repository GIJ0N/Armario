import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { GarmentPhoto } from '../components/GarmentPhoto'
import { useRepository } from '../components/RepositoryContext'
import {
  CATEGORIES,
  CATEGORY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type Category,
  type Garment,
  type Status,
} from '../db'

const DEFAULT_STATUSES: Status[] = ['active', 'laundry']

export default function ArmarioPage() {
  const repo = useRepository()
  const [category, setCategory] = useState<Category | ''>('')
  const [statusFilter, setStatusFilter] = useState<Status | 'default'>('default')
  const [garments, setGarments] = useState<Garment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const statuses = statusFilter === 'default' ? DEFAULT_STATUSES : [statusFilter]
    setGarments(await repo.list({ category: category || undefined, statuses }))
  }, [repo, category, statusFilter])

  useEffect(() => {
    let cancelled = false
    void repo
      .list({
        category: category || undefined,
        statuses: statusFilter === 'default' ? DEFAULT_STATUSES : [statusFilter],
      })
      .then((list) => !cancelled && setGarments(list))
    return () => {
      cancelled = true
    }
  }, [repo, category, statusFilter])

  async function toggleLaundry(g: Garment) {
    setError(null)
    try {
      await repo.setStatus(g.id, g.status === 'laundry' ? 'active' : 'laundry')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
  }

  return (
    <section>
      <h1 className="page-title">Armario</h1>
      <div className="filters">
        <label className="field">
          <span>Categoría</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
            <option value="">Todas</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Estado</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as Status | 'default')}>
            <option value="default">Activas y en lavandería</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      {garments && (
        <p className="page-hint" data-testid="count">
          {garments.length === 1 ? '1 prenda' : `${garments.length} prendas`}
        </p>
      )}
      {garments && garments.length === 0 && (
        <p className="page-hint">
          No hay prendas con estos filtros. <Link to="/agregar">Agrega una</Link>.
        </p>
      )}
      <ul className="grid">
        {garments?.map((g) => {
          const title = g.subcategory || CATEGORY_LABELS[g.category]
          return (
            <li key={g.id} className="card">
              <Link to={`/armario/${g.id}`} className="card-link" aria-label={`Editar ${title}`}>
                <div className="card-photo">
                  <GarmentPhoto photoPath={g.photo_path} alt={title} />
                </div>
                <div className="card-body">
                  <strong>{title}</strong>
                  <span className="muted">{CATEGORY_LABELS[g.category]}</span>
                  {g.status !== 'active' && <span className="badge">{STATUS_LABELS[g.status]}</span>}
                </div>
              </Link>
              {(g.status === 'active' || g.status === 'laundry') && (
                <button type="button" className="btn btn-small" onClick={() => void toggleLaundry(g)}>
                  {g.status === 'laundry' ? 'Marcar activa' : 'A lavandería'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
