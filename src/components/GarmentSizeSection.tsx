import { RotateCcw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { SCALE_MAX, SCALE_MIN, garmentAdjustsEqual, normalizeGarmentAdjust } from '../canvas/adjust'
import type { Garment } from '../db'
import { OutfitCanvas } from './OutfitCanvas'
import { useRepository } from './RepositoryContext'
import { useToast } from './ToastProvider'

const SAVE_DELAY_MS = 350

/**
 * «Tamaño en el maniquí» (detalle de la prenda): vista previa de la prenda sola sobre el maniquí y un control de tamaño
 * que se guarda en `garments.canvas_adjust` y vale en todos los outfits. La posición se ajusta desde «Ajustar» en un outfit.
 */
export function GarmentSizeSection({ garment, onChange }: { garment: Garment; onChange: (g: Garment) => void }) {
  const repo = useRepository()
  const toast = useToast()
  const sliderId = useId()
  const saved = garment.canvas_adjust ?? null
  const [scale, setScale] = useState(saved?.scale ?? 1)
  const pending = useRef<number | null>(null)
  const latest = useRef({ garment, onChange })
  useEffect(() => {
    latest.current = { garment, onChange }
  })

  async function write(value: number | null) {
    const { garment: g, onChange: notify } = latest.current
    const base = g.canvas_adjust ?? { scale: 1, dx: 0, dy: 0 }
    const next = value === null ? null : normalizeGarmentAdjust({ ...base, scale: value })
    if (garmentAdjustsEqual(g.canvas_adjust, next)) return
    try {
      notify(await repo.setCanvasAdjust(g.id, next))
    } catch {
      toast('No se pudo guardar el tamaño')
    }
  }

  // Guarda poco después del último cambio del control y, si se sale de la pantalla, lo pendiente.
  useEffect(() => {
    if (pending.current === null) return
    const t = setTimeout(() => {
      const v = pending.current
      pending.current = null
      if (v !== null) void write(v)
    }, SAVE_DELAY_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])
  useEffect(
    () => () => {
      const v = pending.current
      pending.current = null
      if (v !== null) void write(v)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const preview: Garment = { ...garment, canvas_adjust: { dx: saved?.dx ?? 0, dy: saved?.dy ?? 0, scale } }
  const percent = Math.round(scale * 100)
  const modified = scale !== 1 || !!saved

  return (
    <div className="adjust-size-section" data-testid="garment-size">
      <h2 className="section-title">Tamaño en el maniquí</h2>
      <p className="page-hint">Si esta prenda se ve muy chica o muy grande en los outfits, ajusta su tamaño aquí. Vale para todos los outfits.</p>
      <div className="adjust-preview">
        <OutfitCanvas items={[preview]} size="small" chips={false} />
      </div>
      <div className="adjust-size">
        <label htmlFor={sliderId} className="sr-only">
          Tamaño de la prenda en el maniquí
        </label>
        <input
          id={sliderId}
          type="range"
          min={SCALE_MIN * 100}
          max={SCALE_MAX * 100}
          step={1}
          value={percent}
          aria-valuetext={`${percent} %`}
          onChange={(e) => {
            const v = Number(e.target.value) / 100
            pending.current = v
            setScale(v)
          }}
        />
        <output className="adjust-percent">{percent} %</output>
        <button
          type="button"
          className="btn btn-small"
          disabled={!modified}
          onClick={() => {
            pending.current = null
            setScale(1)
            void write(null)
          }}
        >
          <RotateCcw size={16} aria-hidden="true" />
          Restablecer
        </button>
      </div>
    </div>
  )
}
