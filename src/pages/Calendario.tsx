import { CalendarClock, Check, ChevronLeft, ChevronRight, CalendarRange } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addMonths, firstDayOf, lastDayOf, monthOf, monthTitle, type YearMonth } from '../calendar/grid'
import { DayFlow } from '../components/DayFlow'
import { MonthGrid } from '../components/MonthGrid'
import { PlanWeekSheet } from '../components/PlanWeekSheet'
import { useRepository } from '../components/RepositoryContext'
import { SkeletonBlock } from '../components/Skeleton'
import type { Garment, PlanEntry, WearEntry } from '../db'
import { localDateString } from '../lib/date'
import { loadDailyForecast, type DailyForecastResult } from '../weather'

interface MonthData {
  key: string
  wears: WearEntry[]
  plans: PlanEntry[]
}

const keyOf = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, '0')}`

function groupByDate<T extends { date: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) out.set(r.date, [...(out.get(r.date) ?? []), r])
  return out
}

/** Calendario: lo que usaste y lo que planeaste, mes por mes. Se llega desde Hoy, Yo y Uso; la pestaña activa es Hoy. */
export default function CalendarioPage() {
  const repo = useRepository()
  const today = localDateString()
  const [ym, setYm] = useState<YearMonth>(() => monthOf(today))
  const [data, setData] = useState<MonthData | null>(null)
  const [garments, setGarments] = useState<Garment[]>([])
  const [forecast, setForecast] = useState<DailyForecastResult | null>(null)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const current = useRef(ym)
  useEffect(() => {
    current.current = ym
  }, [ym])

  const fetchMonth = useCallback(
    async (target: YearMonth) => {
      const from = firstDayOf(target)
      const to = lastDayOf(target)
      const [wears, plans, all] = await Promise.all([repo.wears.listBetween(from, to), repo.plans.listBetween(from, to), repo.list()])
      return { all, month: { key: keyOf(target), wears, plans } satisfies MonthData }
    },
    [repo],
  )

  const apply = useCallback((r: Awaited<ReturnType<typeof fetchMonth>>) => {
    // Si el mes cambió mientras se cargaba, esta respuesta ya no sirve.
    if (keyOf(current.current) !== r.month.key) return
    setGarments(r.all)
    setData(r.month)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchMonth(ym).then(
      (r) => !cancelled && apply(r),
      (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'No se pudo cargar el calendario.'),
    )
    return () => {
      cancelled = true
    }
  }, [fetchMonth, apply, ym])

  // Pronóstico de 7 días: una vez; sin red ni caché el calendario sigue funcionando con clima templado.
  useEffect(() => {
    let cancelled = false
    void loadDailyForecast().then((f) => !cancelled && setForecast(f))
    return () => {
      cancelled = true
    }
  }, [])

  const garmentsById = useMemo(() => new Map(garments.map((g) => [g.id, g])), [garments])
  const loaded = data && data.key === keyOf(ym) ? data : null
  const wornByDate = useMemo(() => groupByDate(loaded?.wears ?? []), [loaded])
  const plannedByDate = useMemo(() => groupByDate(loaded?.plans ?? []), [loaded])

  const reload = useCallback(async () => apply(await fetchMonth(ym)), [apply, fetchMonth, ym])

  function closeDay() {
    const date = openDate
    setOpenDate(null)
    // El foco vuelve al día que se abrió (BottomSheet lo devuelve; esto cubre el caso en que la celda ya no sea la misma).
    setTimeout(() => {
      const cell = document.querySelector<HTMLElement>(`.cal-cell[data-date="${date}"]`)
      if (cell && document.activeElement !== cell) cell.focus()
    }, 0)
  }

  const isCurrentMonth = keyOf(ym) === keyOf(monthOf(today))

  return (
    <section>
      <div className="page-head">
        <h1 className="page-title">Calendario</h1>
        <button type="button" className="btn btn-primary btn-inline" onClick={() => setPlanning(true)}>
          <CalendarRange size={18} aria-hidden="true" />
          Planear semana
        </button>
      </div>

      <div className="cal-nav">
        <button type="button" className="icon-btn" aria-label="Mes anterior" onClick={() => setYm(addMonths(ym, -1))}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <h2 className="cal-title" aria-live="polite" data-testid="month-title">
          {monthTitle(ym)}
        </h2>
        <button type="button" className="icon-btn" aria-label="Mes siguiente" onClick={() => setYm(addMonths(ym, 1))}>
          <ChevronRight size={22} aria-hidden="true" />
        </button>
        <button type="button" className="btn btn-inline" disabled={isCurrentMonth} onClick={() => setYm(monthOf(today))}>
          Hoy
        </button>
      </div>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!data ? (
        <SkeletonBlock height={380} />
      ) : (
        <MonthGrid
          ym={ym}
          today={today}
          wornByDate={wornByDate}
          plannedByDate={plannedByDate}
          garments={garmentsById}
          onMonthChange={setYm}
          onOpenDay={(date, el) => {
            opener.current = el
            setOpenDate(date)
          }}
        />
      )}

      <p className="cal-legend" aria-hidden="true">
        <span>
          <Check size={12} strokeWidth={3} /> Usado
        </span>
        <span>
          <CalendarClock size={12} strokeWidth={2.4} /> Planeado
        </span>
      </p>

      {openDate && (
        <DayFlow
          date={openDate}
          today={today}
          wears={wornByDate.get(openDate) ?? []}
          plans={plannedByDate.get(openDate) ?? []}
          garments={garments}
          forecast={forecast}
          onChanged={reload}
          onClose={closeDay}
        />
      )}
      {planning && <PlanWeekSheet today={today} forecast={forecast} onSaved={reload} onClose={() => setPlanning(false)} />}
    </section>
  )
}
