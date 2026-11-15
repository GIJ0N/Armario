import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  role?: 'dialog' | 'alertdialog'
  /** Descripción enlazada con aria-describedby. */
  descriptionId?: string
  /** Elemento que recibe el foco al abrir (por defecto, el primero enfocable). */
  initialFocus?: React.RefObject<HTMLElement | null>
}

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Hoja inferior modal: sube desde abajo, cierra con Escape o tocando el fondo, atrapa el foco y lo devuelve al cerrar. */
export function BottomSheet({ title, onClose, children, role = 'dialog', descriptionId, initialFocus }: Props) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const sheet = sheetRef.current
    ;(initialFocus?.current ?? sheet?.querySelector<HTMLElement>(FOCUSABLE) ?? sheet)?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !sheet) return
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (!sheet.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [initialFocus])

  return (
    <div className="sheet-backdrop" onClick={() => onClose()}>
      <div
        ref={sheetRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
