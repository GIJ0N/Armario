import { Children, useCallback, useRef, useState, type ReactNode } from 'react'

/** Carrusel horizontal con scroll-snap (una tarjeta por vista) e indicador de puntos «1/3». `locked` (modo «Ajustar») bloquea el deslizamiento. */
export function OutfitCarousel({ children, label = 'Outfits', locked = false }: { children: ReactNode; label?: string; locked?: boolean }) {
  const listRef = useRef<HTMLUListElement>(null)
  const [index, setIndex] = useState(0)
  const count = Children.count(children)

  const onScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    let best = 0
    let bestDist = Infinity
    Array.from(el.children).forEach((c, i) => {
      const d = Math.abs((c as HTMLElement).offsetLeft - el.offsetLeft - el.scrollLeft)
      if (d < bestDist) {
        best = i
        bestDist = d
      }
    })
    setIndex(best)
  }, [])

  function goTo(i: number) {
    const el = listRef.current
    const child = el?.children[i] as HTMLElement | undefined
    if (!el || !child) return
    setIndex(i)
    el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'smooth' })
  }

  return (
    <div className="carousel" data-testid="outfit-carousel" data-locked={locked || undefined}>
      <ul className="outfits outfits-carousel" ref={listRef} onScroll={onScroll} aria-label={label}>
        {children}
      </ul>
      {count > 1 && (
        <div className="carousel-dots" role="group" aria-label="Elegir outfit">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              className="carousel-dot"
              disabled={locked}
              data-testid="carousel-dot"
              aria-label={`Outfit ${i + 1} de ${count}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => goTo(i)}
            />
          ))}
          <span className="carousel-count" data-testid="carousel-count" aria-hidden="true">
            {index + 1}/{count}
          </span>
        </div>
      )}
    </div>
  )
}
