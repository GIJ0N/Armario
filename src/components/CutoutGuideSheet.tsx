import { useState } from 'react'
import { BottomSheet } from './BottomSheet'

/** Guía «Quitar el fondo con tu iPhone»: los recortes de Fotos y Archivos se usan directamente, sin el modelo. */
export function CutoutGuideSheet({ onClose }: { onClose: () => void }) {
  return (
    <BottomSheet title="Quitar el fondo con tu iPhone" onClose={onClose}>
      <div className="guide">
        <h3 className="guide-heading">Una prenda</h3>
        <ol className="guide-steps">
          <li>Toma la foto con la prenda extendida, sobre un fondo liso que contraste y con buena luz.</li>
          <li>En Fotos, mantén presionada la prenda hasta que brille el contorno y toca «Copiar».</li>
          <li>Aquí toca «Pegar foto».</li>
        </ol>
        <h3 className="guide-heading">Varias a la vez</h3>
        <ol className="guide-steps">
          <li>Guarda las fotos en Archivos.</li>
          <li>Selecciónalas, toca «…» → Acciones rápidas → «Eliminar fondo».</li>
          <li>En Agregar elige todas las imágenes nuevas.</li>
        </ol>
        <button type="button" className="btn btn-block" onClick={onClose}>
          Entendido
        </button>
      </div>
    </BottomSheet>
  )
}

/** Botón «¿Cómo quito el fondo?» que abre la guía. */
export function CutoutGuideButton({ className = 'btn btn-quiet btn-inline' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        ¿Cómo quito el fondo?
      </button>
      {open && <CutoutGuideSheet onClose={() => setOpen(false)} />}
    </>
  )
}
