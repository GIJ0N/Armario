import { Shirt, Search, WashingMachine, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { GarmentPhoto } from '../components/GarmentPhoto'
import { useRepository } from '../components/RepositoryContext'
import { SkeletonGrid } from '../components/Skeleton'
import { useToast } from '../components/ToastProvider'
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

const normalize = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** Busca por nombre, subcategoría, color y material (sin distinguir acentos ni mayúsculas). */
function matchesQuery(g: Garment, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true
  const haystack = normalize([g.subcategory, CATEGORY_LABELS[g.category], ...g.colors, g.material].join(' '))
  return terms.every((t) => haystack.includes(t))
}

export default function ArmarioPage() {
  const repo = useRepository()
  const [category, setCategory] = useState<Category | ''>('')
  const [statusFilter, setStatusFilter] = useState<Status | 'default'>('default')
  const [garments, setGarments] = useState<Garment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const toast = useToast()

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
      toast(g.status === 'laundry' ? 'Prenda activa de nuevo' : 'Prenda enviada a lavandería')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
  }

  const visible = useMemo(() => garments?.filter((g) => matchesQuery(g, query)) ?? null, [garments, query])

  return (
    <section>
      <h1 className="page-title">Armario</h1>
      <div className="filter-bar">
      <label className="search-box">
        <span className="sr-only">Buscar prendas</span>
        <Search className="icon" size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          placeholder="Buscar por nombre, color o material"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
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
            <option value="default">Activas y lavandería</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
      </div>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      {visible && (
        <p className="page-hint" data-testid="count">
          {visible.length === 1 ? '1 prenda' : `${visible.length} prendas`}
        </p>
      )}
      {!visible && <SkeletonGrid />}
      {visible && visible.length === 0 && (
        <div className="empty">
          <Shirt size={40} strokeWidth={1.3} aria-hidden="true" />
          <p>
            {garments && garments.length > 0
              ? 'No hay prendas que coincidan con tu búsqueda.'
              : 'No hay prendas con estos filtros.'}{' '}
            <Link to="/agregar">Agrega una</Link>.
          </p>
        </div>
      )}
      <ul className="grid">
        {visible?.map((g) => {
          const title = g.subcategory || CATEGORY_LABELS[g.category]
          const toggleable = g.status === 'active' || g.status === 'laundry'
          return (
            <li key={g.id} className="card">
              <Link to={`/armario/${g.id}`} className="card-link" aria-label={`Editar ${title}`}>
                <div className="card-photo">
                  <GarmentPhoto photoPath={g.photo_path} alt={title} />
                </div>
                <div className="card-body">
                  <strong>{title}</strong>
                  <span className="muted">{CATEGORY_LABELS[g.category]}</span>
                </div>
              </Link>
              {g.status !== 'active' && <span className="badge">{STATUS_LABELS[g.status]}</span>}
              {toggleable && (
                <button
                  type="button"
                  className="card-action"
                  aria-label={g.status === 'laundry' ? 'Marcar activa' : 'A lavandería'}
                  onClick={() => void toggleLaundry(g)}
                >
                  <span>
                    {g.status === 'laundry' ? <Undo2 size={15} aria-hidden="true" /> : <WashingMachine size={15} aria-hidden="true" />}
                  </span>
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
