import { describe, expect, it } from 'vitest'
import {
  addMonths,
  dayAriaLabel,
  daysInMonth,
  firstDayOf,
  lastDayOf,
  longDayLabel,
  monthGrid,
  monthOf,
  monthTitle,
  weekdayIndex,
} from '../src/calendar/grid'
import { defaultOccasionFor, defaultPlanDays, mostUsedWeekdayOccasion } from '../src/calendar/planWeek'
import { addDays } from '../src/lib/date'

const flat = (ym: { year: number; month: number }) => monthGrid(ym).flat()

describe('cuadrícula del mes (lunes primero)', () => {
  it('noviembre 2026 empieza en domingo: 6 días de relleno y 5 semanas', () => {
    expect(weekdayIndex('2026-11-01')).toBe(6)
    const weeks = monthGrid({ year: 2026, month: 11 })
    expect(weeks).toHaveLength(6)
    expect(weeks[0][0].date).toBe('2026-10-26')
    expect(weeks[0].slice(0, 6).every((d) => !d.inMonth)).toBe(true)
    expect(weeks[0][6]).toMatchObject({ date: '2026-11-01', day: 1, inMonth: true })
    expect(weeks[5].slice(0, 1)).toEqual([{ date: '2026-11-30', day: 30, inMonth: true }])
    expect(weeks[5][1]).toMatchObject({ date: '2026-12-01', inMonth: false })
  })

  it('cada semana tiene 7 días, empieza en lunes y no hay días repetidos ni saltos', () => {
    for (const ym of [
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
      { year: 2027, month: 8 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]) {
      const weeks = monthGrid(ym)
      for (const w of weeks) {
        expect(w).toHaveLength(7)
        expect(weekdayIndex(w[0].date)).toBe(0)
      }
      const days = weeks.flat()
      for (let i = 1; i < days.length; i++) expect(days[i].date).toBe(addDays(days[i - 1].date, 1))
      expect(days.filter((d) => d.inMonth)).toHaveLength(daysInMonth(ym))
    }
  })

  it('febrero 2027 (no bisiesto) empieza en lunes y cabe en 4 semanas exactas', () => {
    const weeks = monthGrid({ year: 2027, month: 2 })
    expect(weeks).toHaveLength(4)
    expect(weeks[0][0]).toMatchObject({ date: '2027-02-01', inMonth: true })
    expect(weeks[3][6]).toMatchObject({ date: '2027-02-28', inMonth: true })
  })

  it('febrero bisiesto (2028) tiene 29 días; 2100 no es bisiesto', () => {
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29)
    expect(daysInMonth({ year: 2100, month: 2 })).toBe(28)
    expect(daysInMonth({ year: 2000, month: 2 })).toBe(29)
    expect(lastDayOf({ year: 2028, month: 2 })).toBe('2028-02-29')
    const days = flat({ year: 2028, month: 2 }).filter((d) => d.inMonth)
    expect(days.at(-1)?.date).toBe('2028-02-29')
    expect(days.at(-1) && weekdayIndex(days.at(-1)!.date)).toBe(1) // martes
  })

  it('los días de relleno cruzan el cambio de año', () => {
    const jan = flat({ year: 2027, month: 1 })
    expect(jan[0].date).toBe('2026-12-28')
    const dec = flat({ year: 2026, month: 12 })
    expect(dec.at(-1)?.date).toBe('2027-01-03')
  })

  it('addMonths cruza años en ambos sentidos', () => {
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 })
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(addMonths({ year: 2026, month: 11 }, 14)).toEqual({ year: 2028, month: 1 })
    expect(addMonths({ year: 2026, month: 11 }, -23)).toEqual({ year: 2024, month: 12 })
    expect(monthOf('2026-02-28')).toEqual({ year: 2026, month: 2 })
    expect(firstDayOf({ year: 2026, month: 2 })).toBe('2026-02-01')
  })

  it('los días de la semana son correctos en fechas conocidas (sin depender de la zona horaria)', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0) // lunes
    expect(weekdayIndex('2026-11-15')).toBe(6) // domingo
    expect(weekdayIndex('2024-02-29')).toBe(3) // jueves
    // Fechas de cambio de horario en EE. UU. / Europa: la aritmética de enteros no se mueve.
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(weekdayIndex('2026-03-09')).toBe(0)
  })

  it('títulos y etiquetas en español', () => {
    expect(monthTitle({ year: 2026, month: 11 })).toBe('Noviembre 2026')
    expect(longDayLabel('2026-11-16')).toBe('lunes 16 de noviembre')
    expect(longDayLabel('2026-03-01')).toBe('domingo 1 de marzo')
  })
})

describe('etiqueta accesible del día', () => {
  it('cuenta outfits usados y planeados', () => {
    expect(dayAriaLabel('2026-11-16', 1, 1)).toBe('lunes 16 de noviembre, 1 outfit usado, 1 planeado')
    expect(dayAriaLabel('2026-11-17', 2, 0)).toBe('martes 17 de noviembre, 2 outfits usados')
    expect(dayAriaLabel('2026-11-18', 0, 3)).toBe('miércoles 18 de noviembre, 3 planeados')
    expect(dayAriaLabel('2026-11-19', 0, 0)).toBe('jueves 19 de noviembre, sin outfit')
    expect(dayAriaLabel('2026-11-16', 1, 0, '2026-11-16')).toBe('lunes 16 de noviembre, hoy, 1 outfit usado')
  })
})

describe('planear semana: valores por defecto', () => {
  it('los próximos 5 días entre semana sin plan, a partir de mañana', () => {
    // 2026-11-15 es domingo: mañana lunes 16.
    expect(defaultPlanDays('2026-11-15', new Set())).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'])
    // Un viernes: salta el fin de semana.
    expect(defaultPlanDays('2026-11-13', new Set())).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'])
    // Los días con plan se saltan.
    expect(defaultPlanDays('2026-11-15', new Set(['2026-11-16', '2026-11-18']))).toEqual([
      '2026-11-17',
      '2026-11-19',
      '2026-11-20',
      '2026-11-23',
      '2026-11-24',
    ])
  })

  it('ocasión entre semana: la más usada de lunes a viernes; sin historial, trabajo en planta; fin de semana casual', () => {
    expect(mostUsedWeekdayOccasion([])).toBe('plant_work')
    expect(
      mostUsedWeekdayOccasion([
        { date: '2026-11-16', occasion: 'office' }, // lunes
        { date: '2026-11-17', occasion: 'office' },
        { date: '2026-11-18', occasion: 'gym' },
        { date: '2026-11-14', occasion: 'casual' }, // sábado: no cuenta
        { date: '2026-11-15', occasion: 'casual' },
        { date: '2026-11-08', occasion: 'casual' },
      ]),
    ).toBe('office')
    expect(mostUsedWeekdayOccasion([{ date: '2026-11-14', occasion: 'date' }])).toBe('plant_work')
    expect(defaultOccasionFor('2026-11-16', 'office')).toBe('office')
    expect(defaultOccasionFor('2026-11-14', 'office')).toBe('casual')
    expect(defaultOccasionFor('2026-11-15', 'office')).toBe('casual')
  })
})
