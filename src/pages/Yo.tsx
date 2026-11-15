import { BarChart3, ChevronRight, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRepository } from '../components/RepositoryContext'
import { SkeletonBlock } from '../components/Skeleton'
import { UsageHeadline } from '../components/UsageHeadline'
import type { WearStats } from '../db'

export default function YoPage() {
  const repo = useRepository()
  const [stats, setStats] = useState<WearStats | null>(null)

  useEffect(() => {
    let cancelled = false
    void repo.wears.stats().then(
      (s) => !cancelled && setStats(s),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [repo])

  return (
    <section>
      <h1 className="page-title">Yo</h1>
      {stats ? <UsageHeadline stats={stats} /> : <SkeletonBlock height={132} />}
      <ul className="link-list">
        <li>
          <Link to="/uso" className="link-row">
            <BarChart3 className="icon" size={22} aria-hidden="true" />
            <span className="link-row-text">
              Uso
              <small>Qué prendas usas, cuáles no y tu historial</small>
            </span>
            <ChevronRight className="icon" size={20} aria-hidden="true" />
          </Link>
        </li>
        <li>
          <Link to="/ajustes" className="link-row">
            <Settings className="icon" size={22} aria-hidden="true" />
            <span className="link-row-text">
              Ajustes
              <small>IA, ciudad, apariencia y respaldo</small>
            </span>
            <ChevronRight className="icon" size={20} aria-hidden="true" />
          </Link>
        </li>
      </ul>
    </section>
  )
}
