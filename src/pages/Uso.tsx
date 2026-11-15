import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { WardrobeGaps } from '../components/WardrobeGaps'
import { SkeletonBlock, SkeletonRows } from '../components/Skeleton'
import { UsageHeadline } from '../components/UsageHeadline'
import { GarmentPhoto } from '../components/GarmentPhoto'
import { useRepository } from '../components/RepositoryContext'
import { CATEGORY_LABELS, OCCASION_LABELS, type Garment, type WearEntry, type WearStats } from '../db'
import { daysBetween } from '../engine'
import { firstDayOf, monthOf, parseDate } from '../calendar/grid'
import { addDays, localDateString } from '../lib/date'

const LEAST_USED_COUNT = 10
const MOST_USED_COUNT = 5
const HISTORY_LIMIT = 200

interface UsageData {
  garments: Garment[]
  stats: WearStats
  history: WearEntry[]
  /** Días distintos de este mes con al menos un outfit usado. */
  monthDays: number
}

const nameOf = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

function pluralDays(n: number) {
  return `${n} ${n === 1 ? 'día' : 'días'}`
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'Hoy'
  if (date === addDays(today, -1)) return 'Ayer'
  const [y, m, d] = date.split('-').map(Number)
  const text = new Date(y, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function Thumb({ g }: { g: Garment }) {
  return (
    <div className="usage-thumb">
      <GarmentPhoto photoPath={g.photo_path} cutoutPath={g.cutout_path} alt={nameOf(g)} />
    </div>
  )
}

export default function UsoPage() {
  const repo = useRepository()
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const today = localDateString()
    Promise.all([
      repo.list(),
      repo.wears.stats(),
      repo.wears.listHistory(HISTORY_LIMIT),
      repo.wears.listBetween(firstDayOf(monthOf(today)), today),
    ]).then(
      ([garments, stats, history, month]) =>
        !cancelled && setData({ garments, stats, history, monthDays: new Set(month.map((w) => w.date)).size }),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudo cargar el uso.'),
    )
    return () => {
      cancelled = true
    }
  }, [repo])

  if (error) return <p role="alert" className="form-error">{error}</p>
  if (!data) return (
    <section>
      <h1 className="page-title">Uso</h1>
      <SkeletonBlock height={132} />
      <SkeletonRows count={5} />
    </section>
  )

  const today = localDateString()
  const { garments, stats, history, monthDays } = data
  const byId = new Map(garments.map((g) => [g.id, g]))
  const statOf = new Map(stats.garments.map((s) => [s.garmentId, s]))
  const active = garments.filter((g) => g.status === 'active')

  const leastUsed = [...active]
    .sort((a, b) => {
      const la = statOf.get(a.id)?.lastWorn ?? null
      const lb = statOf.get(b.id)?.lastWorn ?? null
      if (la === null && lb === null) return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
      if (la === null) return -1
      if (lb === null) return 1
      return la.localeCompare(lb) || a.created_at.localeCompare(b.created_at)
    })
    .slice(0, LEAST_USED_COUNT)

  const mostUsed = active
    .filter((g) => (statOf.get(g.id)?.total ?? 0) > 0)
    .sort((a, b) => {
      const sa = statOf.get(a.id)!
      const sb = statOf.get(b.id)!
      return sb.total - sa.total || sb.lastWorn!.localeCompare(sa.lastWorn!) || a.id.localeCompare(b.id)
    })
    .slice(0, MOST_USED_COUNT)

  const groups: { date: string; entries: WearEntry[] }[] = []
  for (const e of history) {
    const last = groups[groups.length - 1]
    if (last && last.date === e.date) last.entries.push(e)
    else groups.push({ date: e.date, entries: [e] })
  }

  return (
    <section>
      <h1 className="page-title">Uso</h1>

      <UsageHeadline stats={stats} />
      <p className="month-days" data-testid="month-days">
        Días con outfit registrado este mes: <strong>{monthDays}</strong> de {parseDate(today).day}
      </p>

      <h2 className="section-title">Menos usadas</h2>
      {leastUsed.length === 0 ? (
        <p className="page-hint">No hay prendas activas todavía.</p>
      ) : (
        <ul className="usage-list" aria-label="Menos usadas">
          {leastUsed.map((g) => {
            const last = statOf.get(g.id)?.lastWorn ?? null
            const days = last === null ? null : Math.max(daysBetween(last, today), 0)
            return (
              <li key={g.id} className="usage-row">
                <Thumb g={g} />
                <span className="usage-name">{nameOf(g)}</span>
                <span className="muted usage-meta">
                  {days === null ? 'Nunca usada' : days === 0 ? 'Usada hoy' : `${pluralDays(days)} sin usar`}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <h2 className="section-title">Más usadas</h2>
      {mostUsed.length === 0 ? (
        <p className="page-hint">Cuando marques «Me lo pongo» en Hoy, aquí verás tus prendas favoritas.</p>
      ) : (
        <ol className="usage-list" aria-label="Más usadas">
          {mostUsed.map((g) => {
            const n = statOf.get(g.id)!.total
            return (
              <li key={g.id} className="usage-row">
                <Thumb g={g} />
                <span className="usage-name">{nameOf(g)}</span>
                <span className="muted usage-meta">{n === 1 ? '1 uso' : `${n} usos`}</span>
              </li>
            )
          })}
        </ol>
      )}

      <div className="section-row">
        <h2 className="section-title">Historial</h2>
        <Link to="/calendario">Ver calendario</Link>
      </div>
      {groups.length === 0 ? (
        <p className="page-hint">Todavía no has usado ningún outfit. Toca «Me lo pongo» en Hoy para empezar tu historial.</p>
      ) : (
        <div data-testid="history">
          {groups.map((grp) => (
            <div key={grp.date} className="history-day">
              <h3 className="history-date">{dayLabel(grp.date, today)}</h3>
              <ul className="history-entries">
                {grp.entries.map((e) => {
                  const items = e.garmentIds.map((id) => byId.get(id)).filter((g): g is Garment => !!g)
                  return (
                    <li key={e.wearId} className="history-entry" data-testid="history-entry">
                      <span className="badge badge-source">{OCCASION_LABELS[e.occasion]}</span>
                      <ul className="history-thumbs">
                        {items.map((g) => (
                          <li key={g.id} title={nameOf(g)}>
                            <Thumb g={g} />
                          </li>
                        ))}
                      </ul>
                      {e.reasoning && <p className="outfit-reasoning">{e.reasoning}</p>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <WardrobeGaps garments={garments} />
    </section>
  )
}
