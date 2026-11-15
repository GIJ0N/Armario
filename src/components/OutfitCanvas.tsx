import { Footprints, Move, RectangleVertical, Share2, Shirt, Watch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CATEGORY_LABELS, type Category, type Garment } from '../db'
import {
  applyAdjustments,
  diffDraft,
  getOffset,
  pxToViewBox,
  resetAll,
  resetItem,
  setOffset,
  setStacking,
  setTotalScale,
  stepTotalScale,
  totalScale,
  Z_INDEX_BASE,
  type AdjustChange,
  type AdjustTarget,
  type DraftAdjust,
  type OutfitLayout,
} from '../canvas/adjust'
import { CANVAS_H, CANVAS_W, layoutOutfit, type LayoutInput } from '../canvas/layout'
import { MANNEQUIN_HALF, MANNEQUIN_HEAD, MANNEQUIN_TORSO } from '../canvas/mannequin'
import { currentPalette, renderOutfitPng, type ShareItem } from '../canvas/share'
import { shareImageFile } from '../canvas/webShare'
import { AdjustToolbar } from './AdjustToolbar'
import { useToast } from './ToastProvider'
import { useGarmentImages } from './useGarmentImage'

const ICONS: Record<Category, typeof Shirt> = {
  top: Shirt,
  outerwear: Shirt,
  bottom: RectangleVertical,
  shoes: Footprints,
  accessory: Watch,
}

const garmentName = (g: Garment) => g.subcategory || CATEGORY_LABELS[g.category]

/**
 * Maniquí neutro de frente, tipo croquis de moda masculino (sin rostro): hombros redondeados que caen desde el cuello,
 * torso que se afina hacia la cintura, brazos relajados algo separados del cuerpo con manos, piernas con rodillas y
 * pies abiertos hacia afuera. Se dibuja el lado izquierdo y se refleja; los rellenos usan tokens (trazos en `canvas/mannequin.ts`).
 * Anatomía (unidades): cuello ≈ 98, axilas ≈ 150, cintura ≈ 256, cadera ≈ 290, rodillas ≈ 424, tobillos ≈ 536.
 */
function Mannequin() {
  const half = MANNEQUIN_HALF.map((d) => <path key={d} d={d} />)
  return (
    <svg className="mannequin" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} aria-hidden="true" focusable="false">
      <ellipse className="mannequin-ground" cx="160" cy="594" rx="86" ry="5" />
      <g className="mannequin-body">
        <path d={MANNEQUIN_HEAD} />
        <path d={MANNEQUIN_TORSO} />
        {half}
        <g transform={`translate(${CANVAS_W} 0) scale(-1 1)`}>{half}</g>
      </g>
    </svg>
  )
}

export interface OutfitCanvasProps {
  items: Garment[]
  size?: 'large' | 'small'
  /** Se llama al tocar una prenda sobre el lienzo o su etiqueta (la fase 12 abre el editor). */
  onSelectGarment?: (id: string) => void
  /** Prenda candidata: su etiqueta lleva «(nueva)». */
  newId?: string
  /** Muestra la fila de etiquetas con los nombres (por defecto sí). */
  chips?: boolean
  /** Ajustes manuales de este outfit (fase 13a). */
  layout?: OutfitLayout | null
  /** Activa «Ajustar» en el propio lienzo (tamaño grande). Recibe lo que cambió al pulsar «Listo». */
  onAdjustSave?: (change: AdjustChange) => void | Promise<void>
  /** Con lienzo pequeño: «Ajustar» pide al anfitrión abrir un lienzo grande de ajuste. */
  onAdjustRequest?: () => void
  /** Entra directo en modo ajuste (lienzo grande dentro de una hoja). */
  startAdjusting?: boolean
  /** Se llamó a «Cancelar» (útil con `startAdjusting`). */
  onAdjustCancel?: () => void
  /** Avisa al entrar y salir del modo ajuste (Hoy bloquea el deslizamiento del carrusel). */
  onAdjustingChange?: (adjusting: boolean) => void
  /** Muestra «Compartir» (imagen PNG del lienzo). */
  shareable?: boolean
}

const STEP_NUDGE = 2
const STEP_NUDGE_BIG = 10
const STEP_SCALE = 0.05

type Gesture =
  | { kind: 'drag'; id: string; startX: number; startY: number; dx: number; dy: number; target: AdjustTarget }
  | { kind: 'pinch'; id: string; d0: number; t0: number; target: AdjustTarget }

function baseDraftOf(items: Garment[], layout: OutfitLayout | null | undefined): DraftAdjust {
  return { garments: Object.fromEntries(items.map((g) => [g.id, g.canvas_adjust ?? null])), layout: { ...(layout ?? {}) } }
}

/** Outfit sobre un maniquí: recortes sin fondo colocados donde se llevan puestos. Determinista y sin red. */
export function OutfitCanvas({
  items,
  size = 'large',
  onSelectGarment,
  newId,
  chips = true,
  layout,
  onAdjustSave,
  onAdjustRequest,
  startAdjusting = false,
  onAdjustCancel,
  onAdjustingChange,
  shareable = false,
}: OutfitCanvasProps) {
  const toast = useToast()
  const canAdjustHere = !!onAdjustSave && (size === 'large' || startAdjusting)
  const [adjusting, setAdjusting] = useState(startAdjusting && !!onAdjustSave)
  const baseDraft = baseDraftOf(items, layout)
  const [draft, setDraft] = useState<DraftAdjust>(baseDraft)
  const [selected, setSelected] = useState<string | null>(null)
  const [target, setTarget] = useState<AdjustTarget>('outfit')
  const [sharing, setSharing] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  /** Primer dedo sobre el fondo sin moverse: al soltar deselecciona (pero si llega un segundo dedo es un pellizco). */
  const emptyTap = useRef<{ x: number; y: number } | null>(null)

  const sources = items.map((g) => {
    const mask = g.cutout_kind === 'mask' && !!g.cutout_path
    return { key: mask ? g.cutout_path! : (g.cutout_path ?? g.photo_path ?? null), mask }
  })
  const images = useGarmentImages(sources.map((s) => s.key))

  const inputs: LayoutInput[] = items.map((g, i) => {
    const img = sources[i].key ? images.get(sources[i].key!) : undefined
    return {
      id: g.id,
      category: g.category,
      subcategory: g.subcategory,
      aspect: img?.width && img.height ? img.width / img.height : null,
      framed: !(sources[i].mask && img),
    }
  })
  const autoBoxes = layoutOutfit(inputs)
  const effective = adjusting ? draft : baseDraft
  const boxes = applyAdjustments(autoBoxes, effective.garments, effective.layout)
  const byId = new Map(items.map((g, i) => [g.id, { g, i }]))
  const ids = items.map((g) => g.id)
  const selectedGarment = selected ? (byId.get(selected)?.g ?? null) : null

  const notify = useRef(onAdjustingChange)
  useEffect(() => {
    notify.current = onAdjustingChange
  })
  useEffect(() => {
    notify.current?.(adjusting)
  }, [adjusting])
  // Al desmontar en pleno ajuste se libera el bloqueo del carrusel.
  useEffect(() => () => notify.current?.(false), [])

  function startAdjust() {
    setDraft(baseDraftOf(items, layout))
    setSelected(null)
    setTarget('outfit')
    setAdjusting(true)
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // La barra de ajuste queda a la vista, sobre la barra de pestañas (se mide tras pintarla).
    requestAnimationFrame(() =>
      rootRef.current?.querySelector('.adjust-toolbar')?.scrollIntoView?.({ block: 'end', behavior: reduce ? 'auto' : 'smooth' }),
    )
  }

  function finish(save: boolean) {
    pointers.current.clear()
    gesture.current = null
    emptyTap.current = null
    if (save) {
      const { changed, layout: nextLayout, garments } = diffDraft(baseDraft, draft, ids)
      setAdjusting(false)
      if (changed) void onAdjustSave?.({ layout: nextLayout, garments })
      else onAdjustCancel?.()
    } else {
      setAdjusting(false)
      onAdjustCancel?.()
    }
  }

  const autoOf = (id: string) => autoBoxes.find((b) => b.id === id)

  function moveTo(id: string, dx: number, dy: number, which: AdjustTarget = target) {
    const auto = autoOf(id)
    if (auto) setDraft((d) => setOffset(d, auto, id, which, dx, dy))
  }

  function nudge(id: string, ddx: number, ddy: number) {
    const cur = getOffset(draft, id, target)
    moveTo(id, cur.dx + ddx, cur.dy + ddy)
  }

  function pointDistance() {
    const [a, b] = [...pointers.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!adjusting) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    if (pointers.current.size === 1) {
      const hit = (e.target as Element).closest?.('[data-garment-id]')?.getAttribute('data-garment-id') ?? null
      if (hit) {
        setSelected(hit)
        const o = getOffset(draft, hit, target)
        gesture.current = { kind: 'drag', id: hit, startX: e.clientX, startY: e.clientY, dx: o.dx, dy: o.dy, target }
      } else {
        emptyTap.current = { x: e.clientX, y: e.clientY }
        gesture.current = null
      }
    } else if (pointers.current.size === 2 && selected) {
      emptyTap.current = null
      const d0 = pointDistance()
      gesture.current = d0 > 0 ? { kind: 'pinch', id: selected, d0, t0: totalScale(draft, selected), target } : null
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!adjusting || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const tap = emptyTap.current
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) emptyTap.current = null
    const g = gesture.current
    if (!g) return
    if (g.kind === 'drag' && pointers.current.size === 1) {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) return
      const v = pxToViewBox(e.clientX - g.startX, e.clientY - g.startY, rect)
      moveTo(g.id, g.dx + v.dx, g.dy + v.dy, g.target)
    } else if (g.kind === 'pinch' && pointers.current.size === 2) {
      const d = pointDistance()
      if (d > 0) setDraft((cur) => setTotalScale(cur, g.id, g.target, g.t0 * (d / g.d0)))
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.delete(e.pointerId)) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    if (pointers.current.size === 0 && emptyTap.current) setSelected(null)
    if (pointers.current.size === 0) emptyTap.current = null
    const g = gesture.current
    if (pointers.current.size === 1 && selected) {
      // Queda un dedo: sigue arrastrando desde donde está, sin saltos.
      const [p] = [...pointers.current.values()]
      const o = getOffset(draft, selected, target)
      gesture.current = { kind: 'drag', id: selected, startX: p.x, startY: p.y, dx: o.dx, dy: o.dy, target }
    } else if (pointers.current.size === 0 || !g) {
      gesture.current = null
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!adjusting || !selected) return
    const step = e.shiftKey ? STEP_NUDGE_BIG : STEP_NUDGE
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    if (moves[e.key]) {
      e.preventDefault()
      nudge(selected, ...moves[e.key])
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setDraft((d) => stepTotalScale(d, selected, target, STEP_SCALE))
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      setDraft((d) => stepTotalScale(d, selected, target, -STEP_SCALE))
    }
  }

  function pick(id: string) {
    if (adjusting) setSelected(id)
    else onSelectGarment?.(id)
  }

  async function share() {
    setSharing(true)
    try {
      const shareItems: ShareItem[] = boxes.map((b) => {
        const key = sources[byId.get(b.id)!.i].key
        return { box: b, framed: b.framed, src: key ? (images.get(key)?.url ?? null) : null }
      })
      const blob = await renderOutfitPng({ items: shareItems, palette: currentPalette() })
      const result = await shareImageFile(blob, 'outfit.png', 'Mi outfit')
      if (result === 'downloaded') toast('Imagen descargada')
    } catch {
      toast('No se pudo compartir la imagen')
    } finally {
      setSharing(false)
    }
  }

  const iconOnly = size === 'small'
  const showTools = !adjusting && (canAdjustHere || !!onAdjustRequest || shareable)

  return (
    <div className="outfit-canvas" data-size={size} data-adjusting={adjusting || undefined} data-testid="outfit-visual" ref={rootRef}>
      <div className="canvas-panel">
        <div
          ref={stageRef}
          className="canvas-stage"
          data-adjusting={adjusting || undefined}
          style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
          data-testid="canvas-stage"
          {...(adjusting
            ? {
                role: 'group',
                tabIndex: 0,
                'aria-label': 'Lienzo en modo ajuste. Flechas para mover, más y menos para el tamaño.',
                onPointerDown,
                onPointerMove,
                onPointerUp,
                onPointerCancel: onPointerUp,
                onKeyDown,
              }
            : {})}
        >
          <Mannequin />
          {boxes.map((b) => {
            const { g, i } = byId.get(b.id)!
            const img = sources[i].key ? images.get(sources[i].key!) : undefined
            const Icon = ICONS[g.category]
            const isSelected = adjusting && selected === g.id
            return (
              <button
                key={g.id}
                type="button"
                className="canvas-garment"
                data-zone={b.zone}
                data-garment-id={g.id}
                data-scale={b.scale}
                data-z={b.z}
                data-selected={isSelected || undefined}
                aria-label={garmentName(g)}
                aria-pressed={adjusting ? isSelected : undefined}
                onClick={() => pick(g.id)}
                style={{
                  left: `${(b.x / CANVAS_W) * 100}%`,
                  top: `${(b.y / CANVAS_H) * 100}%`,
                  width: `${(b.w / CANVAS_W) * 100}%`,
                  height: `${(b.h / CANVAS_H) * 100}%`,
                  zIndex: Math.round(b.z) + Z_INDEX_BASE,
                }}
              >
                {!b.framed && img ? (
                  <img className="canvas-cutout" src={img.url} alt="" draggable={false} />
                ) : (
                  <span className="canvas-tile" data-testid="canvas-tile">
                    {img ? <img src={img.url} alt="" draggable={false} /> : <Icon strokeWidth={1.4} aria-hidden="true" />}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
      {showTools && (
        <div className="canvas-tools" data-icon-only={iconOnly || undefined}>
          {(canAdjustHere || onAdjustRequest) && (
            <button
              type="button"
              className="btn btn-quiet btn-inline"
              aria-label="Ajustar"
              title="Ajustar"
              onClick={() => (canAdjustHere ? startAdjust() : onAdjustRequest?.())}
            >
              <Move size={16} aria-hidden="true" />
              {!iconOnly && 'Ajustar'}
            </button>
          )}
          {shareable && (
            <button
              type="button"
              className="btn btn-quiet btn-inline"
              aria-label="Compartir"
              title="Compartir"
              disabled={sharing}
              onClick={() => void share()}
            >
              <Share2 size={16} aria-hidden="true" />
              {!iconOnly && 'Compartir'}
            </button>
          )}
        </div>
      )}
      {chips && (
        <ul className="canvas-chips" aria-label="Prendas del outfit">
          {items.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="chip chip-small"
                aria-pressed={adjusting ? selected === g.id : undefined}
                onClick={() => pick(g.id)}
              >
                {garmentName(g)}
                {g.id === newId ? ' (nueva)' : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      {adjusting && (
        <AdjustToolbar
          selectedName={selectedGarment ? garmentName(selectedGarment) : null}
          scale={selected ? totalScale(draft, selected) : 1}
          target={target}
          onTarget={setTarget}
          onScale={(t) => selected && setDraft((d) => setTotalScale(d, selected, target, t))}
          onStep={(delta) => selected && setDraft((d) => stepTotalScale(d, selected, target, delta * STEP_SCALE))}
          onStack={(where) => selected && setDraft((d) => setStacking(d, autoBoxes, selected, where))}
          onReset={() => selected && setDraft((d) => resetItem(d, selected, target))}
          onResetAll={() => setDraft((d) => resetAll(d, ids, target))}
          onDone={() => finish(true)}
          onCancel={() => finish(false)}
        />
      )}
    </div>
  )
}
