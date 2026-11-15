/** Marcadores de carga con la forma del contenido. */
export function SkeletonGrid({ count = 9 }: { count?: number }) {
  return (
    <ul className="skeleton-grid" aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="skeleton skeleton-tile" />
      ))}
    </ul>
  )
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-stack" aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="skeleton skeleton-row" />
      ))}
    </div>
  )
}

export function SkeletonBlock({ height = 120 }: { height?: number }) {
  return <span className="skeleton" style={{ height, borderRadius: 22, margin: '12px 0' }} aria-hidden="true" data-testid="skeleton" />
}
