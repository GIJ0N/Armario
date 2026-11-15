import { CalendarClock, Check } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  addMonths,
  dayAriaLabel,
  daysInMonth,
  formatDate,
  monthGrid,
  monthOf,
  monthTitle,
  parseDate,
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
  weekdayIndex,
  type YearMonth,
} from '../calendar/grid'
import type { Garment, PlanEntry, WearEntry } from '../db'
import { addDays } from '../lib/date'
import { OutfitThumbs } from './OutfitThumbs'

interface Props {
  ym: YearMonth
  /** YYYY-MM-DD */
  today: string
  wornByDate: Map<string, WearEntry[]>
  plannedByDate: Map<string, PlanEntry[]>
  garments: Map<string, Garment>
  onOpenDay: (date: string, el: HTMLElement) => void
  onMonthChange: (ym: YearMonth) => void
}

/** Un desplazamiento horizontal de al menos esto (px), más horizontal que vertical, cambia de mes. */
const SWIPE_MIN_PX = 56

/**
 * Cuadrícula del mes (lunes primero). `role="grid"` con una celda por día del mes: cada una es un botón con su
 * etiqueta («lunes 16 de noviembre, 1 outfit usado, 1 planeado»). Una sola celda está en el orden de tabulación;
 * las flechas mueven entre días, Re Pág / Av Pág entre meses y Inicio / Fin a los extremos de la semana.
 */
export function MonthGrid({ ym, today, wornByDate, plannedByDate, garments, onOpenDay, onMonthChange }: Props) {
  const weeks = monthGrid(ym)
  const initial = today.startsWith(`${ym.year}-${String(ym.month).padStart(2, '0')}`) ? today : formatDate(ym.year, ym.month, 1)
  const [active, setActive] = useState(initial)
  const tableRef = useRef<HTMLTableElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiped = useRef(false)

  // Si cambia el mes por botones o gesto, la celda activa pasa a un día de ese mes (hoy o el día 1).
  const inMonth = (d: string) => {
    const m = monthOf(d)
    return m.year === ym.year && m.month === ym.month
  }
  const current = inMonth(active) ? active : initial
  useEffect(() => {
    const target = pendingFocus.current
    if (target && inMonth(target)) {
      pendingFocus.current = null
      tableRef.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus()
    }
  })

  function moveTo(target: string) {
    if (inMonth(target)) {
      setActive(target)
      tableRef.current?.querySelector<HTMLElement>(`[data-date="${target}"]`)?.focus()
    } else {
      pendingFocus.current = target
      setActive(target)
      onMonthChange(monthOf(target))
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, date: string) {
    let target: string | null = null
    switch (e.key) {
      case 'ArrowLeft':
        target = addDays(date, -1)
        break
      case 'ArrowRight':
        target = addDays(date, 1)
        break
      case 'ArrowUp':
        target = addDays(date, -7)
        break
      case 'ArrowDown':
        target = addDays(date, 7)
        break
      case 'Home':
        target = addDays(date, -weekdayIndex(date))
        break
      case 'End':
        target = addDays(date, 6 - weekdayIndex(date))
        break
      case 'PageUp':
      case 'PageDown': {
        const next = addMonths(monthOf(date), e.key === 'PageUp' ? -1 : 1)
        const { day } = parseDate(date)
        target = formatDate(next.year, next.month, Math.min(day, daysInMonth(next)))
        break
      }
    }
    if (!target) return
    e.preventDefault()
    moveTo(target)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    swiped.current = false
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const s = swipe.current
    swipe.current = null
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped.current = true
      onMonthChange(addMonths(ym, dx < 0 ? 1 : -1))
    }
  }

  return (
    <div
      className="cal-swipe"
      data-testid="month-swipe"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
      // Tras un deslizamiento no debe abrirse el día sobre el que terminó el gesto.
      onClickCapture={(e) => {
        if (swiped.current) {
          swiped.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      }}
    >
      <table ref={tableRef} className="cal-grid" role="grid" aria-label={monthTitle(ym)}>
        <thead>
          <tr role="row">
            {WEEKDAY_INITIALS.map((l, i) => (
              <th key={WEEKDAY_NAMES[i]} role="columnheader" scope="col" abbr={WEEKDAY_NAMES[i]} aria-label={WEEKDAY_NAMES[i]}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date} role="row">
              {week.map((d) => {
                if (!d.inMonth) return <td key={d.date} role="gridcell" className="cal-pad" aria-hidden="true" />
                const worn = wornByDate.get(d.date) ?? []
                const planned = plannedByDate.get(d.date) ?? []
                const total = worn.length + planned.length
                const first = worn[0] ?? planned[0]
                const items = first ? first.garmentIds.map((id) => garments.get(id)).filter((g): g is Garment => !!g) : []
                const state = worn.length > 0 ? 'worn' : planned.length > 0 ? 'planned' : 'empty'
                return (
                  <td key={d.date} role="gridcell" aria-selected={d.date === current}>
                    <button
                      type="button"
                      className="cal-cell"
                      data-date={d.date}
                      data-state={state}
                      data-today={d.date === today || undefined}
                      tabIndex={d.date === current ? 0 : -1}
                      aria-label={dayAriaLabel(d.date, worn.length, planned.length, today)}
                      aria-current={d.date === today ? 'date' : undefined}
                      onFocus={() => setActive(d.date)}
                      onKeyDown={(e) => onKeyDown(e, d.date)}
                      onClick={(e) => onOpenDay(d.date, e.currentTarget)}
                    >
                      <span className="cal-day">{d.day}</span>
                      {items.length > 0 && <OutfitThumbs items={items} />}
                      {state === 'worn' && <Check className="cal-mark" size={11} strokeWidth={3} aria-hidden="true" />}
                      {state === 'planned' && <CalendarClock className="cal-mark" size={11} strokeWidth={2.4} aria-hidden="true" />}
                      {total > 1 && (
                        <span className="cal-more" aria-hidden="true">
                          +{total - 1}
                        </span>
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
