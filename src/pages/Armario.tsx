import { Heart, Plus, Search, Shirt, WashingMachine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { subscribeCutoutChanged } from '../cutout/events'
import { GarmentPhoto } from '../components/GarmentPhoto'
import { OutfitEditorSheet } from '../components/OutfitEditorSheet'
import { SavedOutfitsList } from '../components/SavedOutfitsList'
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
import type { WearRecord } from '../engine'
import { localDateString } from '../lib/date'
import { createManualOutfit } from '../outfits/edit'

const DEFAULT_STATUSES: Status[] = ['active', 'laundry']

type Segment = 'garments' | 'outfits'
const WEARS_LOOKBACK_DAYS = 60

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
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [segment, setSegment] = useState<Segment>('garments')
  const [creating, setCreating] = useState<{ garments: Garment[]; wears: WearRecord[] } | null>(null)
  const [outfitsReload, setOutfitsReload] = useState(0)
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

  // Un recorte que termina en segundo plano aparece sin tener que volver a entrar.
  useEffect(
    () =>
      subscribeCutoutChanged((id) => {
        void repo.get(id).then((fresh) => {
          if (fresh) setGarments((cur) => cur?.map((g) => (g.id === id ? fresh : g)) ?? cur)
        })
      }),
    [repo],
  )

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

  async function toggleFavorite(g: Garment) {
    setError(null)
    try {
      await repo.setFavorite(g.id, !g.favorite)
      await load()
      toast(g.favorite ? 'Quitada de favoritas' : 'Agregada a favoritas')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar.')
    }
  }

  async function openCreate() {
    setError(null)
    try {
      const [all, wearEntries] = await Promise.all([
        repo.list({ statuses: ['active', 'laundry'] }),
        repo.wears.listSince(WEARS_LOOKBACK_DAYS),
      ])
      setCreating({ garments: all, wears: wearEntries.map((w) => ({ garmentIds: w.garmentIds, date: w.date })) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el editor.')
    }
  }

  const visible = useMemo(
    () => garments?.filter((g) => matchesQuery(g, query) && (!onlyFavorites || g.favorite)) ?? null,
    [garments, query, onlyFavorites],
  )

  return (
    <section>
      <div className="page-head">
        <h1 className="page-title">Armario</h1>
        <button type="button" className="btn btn-inline" onClick={() => void openCreate()}>
          <Plus size={16} aria-hidden="true" />
          Crear outfit
        </button>
      </div>
      <div className="chips" role="tablist" aria-label="Secciones del armario">
        {(['garments', 'outfits'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={segment === key}
            className={`chip${segment === key ? ' chip-active' : ''}`}
            onClick={() => setSegment(key)}
          >
            {key === 'garments' ? 'Prendas' : 'Outfits'}
          </button>
        ))}
      </div>
      {segment === 'outfits' && <SavedOutfitsList reloadKey={outfitsReload} />}
      {segment === 'garments' && (
      <>
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
      <button
        type="button"
        className={`chip chip-toggle${onlyFavorites ? ' chip-active' : ''}`}
        aria-pressed={onlyFavorites}
        onClick={() => setOnlyFavorites((v) => !v)}
      >
        <Heart size={16} aria-hidden="true" fill={onlyFavorites ? 'currentColor' : 'none'} />
        Favoritas
      </button>
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
              ? 'No hay prendas que coincidan con tu búsqueda o filtros.'
              : 'No hay prendas con estos filtros.'}{' '}
            <Link to="/agregar">Agrega una</Link>.
          </p>
        </div>
      )}
      <ul className="grid">
        {visible?.map((g) => {
          const title = g.subcategory || CATEGORY_LABELS[g.category]
          return (
            <li key={g.id} className="card">
              <Link to={`/armario/${g.id}`} className="card-link" aria-label={`Editar ${title}`}>
                <div className="card-photo">
                  <GarmentPhoto photoPath={g.photo_path} cutoutPath={g.cutout_path} alt={title} />
                </div>
                <div className="card-body">
                  <strong>{title}</strong>
                  <span className="muted">{CATEGORY_LABELS[g.category]}</span>
                </div>
              </Link>
              {g.status !== 'active' && <span className="badge">{STATUS_LABELS[g.status]}</span>}
              <button
                type="button"
                className={`card-fav${g.favorite ? ' card-fav-on' : ''}`}
                aria-label={g.favorite ? `Quitar ${title} de favoritas` : `Marcar ${title} como favorita`}
                aria-pressed={!!g.favorite}
                onClick={() => void toggleFavorite(g)}
              >
                <Heart size={18} aria-hidden="true" fill={g.favorite ? 'currentColor' : 'none'} />
              </button>
              {g.status === 'active' && (
                <button type="button" className="card-action" aria-label="A lavandería" onClick={() => void toggleLaundry(g)}>
                  <span>
                    <WashingMachine size={15} aria-hidden="true" />
                  </span>
                </button>
              )}
              {g.status === 'laundry' && (
                <button type="button" className="card-clean" onClick={() => void toggleLaundry(g)}>
                  Ya está limpia
                </button>
              )}
            </li>
          )
        })}
      </ul>
      </>
      )}
      {creating && (
        <OutfitEditorSheet
          title="Crear outfit"
          garments={creating.garments}
          wears={creating.wears}
          today={localDateString()}
          onSave={async (value) => {
            const byId = new Map(creating.garments.map((g) => [g.id, g]))
            await createManualOutfit(repo, {
              garmentIds: value.garmentIds,
              occasion: value.occasion,
              name: value.name,
              categoryOf: (id) => byId.get(id)?.category,
            })
            setCreating(null)
            setSegment('outfits')
            setOutfitsReload((n) => n + 1)
            toast('Outfit guardado en Armario › Outfits')
          }}
          onClose={() => setCreating(null)}
        />
      )}
    </section>
  )
}
