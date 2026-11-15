import { ArrowDownToLine, ArrowUpToLine, Minus, Plus, RotateCcw } from 'lucide-react'
import { SCALE_MAX, SCALE_MIN, type AdjustTarget } from '../canvas/adjust'

interface Props {
  /** Nombre de la prenda seleccionada; null si no hay. */
  selectedName: string | null
  /** Tamaño total (1 = automático). */
  scale: number
  target: AdjustTarget
  onTarget: (t: AdjustTarget) => void
  onScale: (total: number) => void
  /** ±1 paso de tamaño. */
  onStep: (direction: 1 | -1) => void
  onStack: (where: 'front' | 'back') => void
  onReset: () => void
  onResetAll: () => void
  onDone: () => void
  onCancel: () => void
}

/** Barra del modo «Ajustar»: tamaño, a qué se aplica, apilado, restablecer, Listo y Cancelar. Cabe en 390 px sin deslizar. */
export function AdjustToolbar({ selectedName, scale, target, onTarget, onScale, onStep, onStack, onReset, onResetAll, onDone, onCancel }: Props) {
  const none = selectedName === null
  const percent = Math.round(scale * 100)
  return (
    <div className="adjust-toolbar" data-testid="adjust-toolbar" role="group" aria-label="Ajustar outfit">
      <p className="adjust-hint" aria-live="polite">
        {none ? 'Toca una prenda para ajustarla. Arrastra para moverla y pellizca para cambiar su tamaño.' : <>Ajustando: <strong>{selectedName}</strong></>}
      </p>
      <div className="adjust-size">
        <button type="button" className="icon-btn" aria-label="Reducir tamaño" disabled={none} onClick={() => onStep(-1)}>
          <Minus size={18} aria-hidden="true" />
        </button>
        <input
          type="range"
          min={SCALE_MIN * 100}
          max={SCALE_MAX * 100}
          step={1}
          value={percent}
          disabled={none}
          aria-label={selectedName ? `Tamaño de ${selectedName}` : 'Tamaño'}
          aria-valuetext={`${percent} %`}
          onChange={(e) => onScale(Number(e.target.value) / 100)}
        />
        <button type="button" className="icon-btn" aria-label="Aumentar tamaño" disabled={none} onClick={() => onStep(1)}>
          <Plus size={18} aria-hidden="true" />
        </button>
        <output className="adjust-percent">{percent} %</output>
      </div>
      <div className="adjust-apply" role="group" aria-labelledby="adjust-apply-label">
        <span className="adjust-apply-label" id="adjust-apply-label">Aplicar a:</span>
        <button type="button" className="chip chip-small" aria-pressed={target === 'outfit'} onClick={() => onTarget('outfit')}>
          Este outfit
        </button>
        <button type="button" className="chip chip-small" aria-pressed={target === 'garment'} onClick={() => onTarget('garment')}>
          Siempre para esta prenda
        </button>
      </div>
      <div className="adjust-row">
        <button type="button" className="btn btn-small" disabled={none} onClick={() => onStack('front')}>
          <ArrowUpToLine size={16} aria-hidden="true" />
          Al frente
        </button>
        <button type="button" className="btn btn-small" disabled={none} onClick={() => onStack('back')}>
          <ArrowDownToLine size={16} aria-hidden="true" />
          Atrás
        </button>
        <button type="button" className="btn btn-small" disabled={none} onClick={onReset}>
          <RotateCcw size={16} aria-hidden="true" />
          Restablecer
        </button>
      </div>
      <div className="adjust-row adjust-row-end">
        <button type="button" className="btn btn-quiet btn-small" onClick={onResetAll}>
          Restablecer todo
        </button>
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn btn-primary btn-small" onClick={onDone}>
          Listo
        </button>
      </div>
    </div>
  )
}
