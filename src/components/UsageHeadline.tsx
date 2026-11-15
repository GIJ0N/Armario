import { USAGE_WINDOW_DAYS, type WearStats } from '../db'

export function UsageHeadline({ stats }: { stats: WearStats }) {
  return (
    <div className="usage-headline" data-testid="usage-headline">
      {stats.activeCount === 0 ? (
        <p className="page-hint">Aún no tienes prendas activas. Agrega prendas en Armario para ver su uso.</p>
      ) : (
        <>
          <strong className="usage-percent" data-testid="usage-percent">
            {Math.round(stats.usedPercent)}%
          </strong>
          <span className="usage-caption">del armario usado en {USAGE_WINDOW_DAYS} días</span>
          <span className="muted usage-count" data-testid="usage-count">
            {stats.usedLast30} de {stats.activeCount} prendas activas
          </span>
        </>
      )}
    </div>
  )
}
