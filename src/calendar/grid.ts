import { addDays } from '../lib/date'

/**
 * Aritmética de calendario sobre fechas locales YYYY-MM-DD. Todo se calcula con enteros y con `Date.UTC`
 * (sin zona horaria ni horario de verano), así que un mes siempre tiene sus días exactos.
 */

export interface YearMonth {
  year: number
  /** 1-12 */
  month: number
}

export const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'] as const
export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const
export const MONTH_NAMES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

const p2 = (n: number) => String(n).padStart(2, '0')

export function parseDate(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  return { year, month, day }
}

export function formatDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${p2(month)}-${p2(day)}`
}

export function monthOf(date: string): YearMonth {
  const { year, month } = parseDate(date)
  return { year, month }
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth({ year, month }: YearMonth): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

/** 0 = lunes … 6 = domingo. */
export function weekdayIndex(date: string): number {
  const { year, month, day } = parseDate(date)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 }
}

export const firstDayOf = ({ year, month }: YearMonth) => formatDate(year, month, 1)
export const lastDayOf = (ym: YearMonth) => formatDate(ym.year, ym.month, daysInMonth(ym))

export interface GridDay {
  /** YYYY-MM-DD */
  date: string
  day: number
  /** false para los días de relleno del mes anterior o siguiente. */
  inMonth: boolean
}

/**
 * Cuadrícula del mes, lunes primero: semanas completas de 7 días, con los días del mes anterior al inicio y los
 * del siguiente al final (4 a 6 semanas).
 */
export function monthGrid(ym: YearMonth): GridDay[][] {
  const first = firstDayOf(ym)
  const start = addDays(first, -weekdayIndex(first))
  const total = Math.ceil((weekdayIndex(first) + daysInMonth(ym)) / 7) * 7
  const weeks: GridDay[][] = []
  for (let i = 0; i < total; i += 7) {
    weeks.push(
      Array.from({ length: 7 }, (_, j) => {
        const date = addDays(start, i + j)
        const parsed = parseDate(date)
        return { date, day: parsed.day, inMonth: parsed.year === ym.year && parsed.month === ym.month }
      }),
    )
  }
  return weeks
}

export function monthTitle({ year, month }: YearMonth): string {
  const name = MONTH_NAMES[month - 1]
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`
}

/** «lunes 16 de noviembre» (sin año). */
export function longDayLabel(date: string): string {
  const { month, day } = parseDate(date)
  return `${WEEKDAY_NAMES[weekdayIndex(date)]} ${day} de ${MONTH_NAMES[month - 1]}`
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Etiqueta accesible de un día: «lunes 16 de noviembre, 1 outfit usado, 1 planeado». */
export function dayAriaLabel(date: string, worn: number, planned: number, today?: string): string {
  const parts = [longDayLabel(date)]
  if (today && date === today) parts.push('hoy')
  if (worn > 0) parts.push(`${count(worn, 'outfit usado', 'outfits usados')}`)
  if (planned > 0) parts.push(`${count(planned, 'planeado', 'planeados')}`)
  if (worn === 0 && planned === 0) parts.push('sin outfit')
  return parts.join(', ')
}

/** Días de la semana (Mon..Sun) de una fecha ya en la cuadrícula: ¿es fin de semana? */
export const isWeekend = (date: string) => weekdayIndex(date) >= 5
