// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MockAiProvider } from '../src/ai/mock'
import { OCCASIONS } from '../src/db/types'
import {
  buildPlan,
  comboKey,
  daysBetween,
  NO_REPEAT_DAYS,
  suggestOutfits,
  type SuggestedOutfit,
  type WearRecord,
} from '../src/engine'
import { addDays } from '../src/lib/date'
import { COLD, HOT, MILD, wardrobe30 } from './fixtures/wardrobe30'

const START = '2026-10-01'
const DAYS = 30
/** El clima cambia con los días para tocar todo el armario. */
const WEATHERS = [MILD, HOT, MILD, COLD, MILD]
const byId = new Map(wardrobe30.map((g) => [g.id, g]))

interface DayLog {
  date: string
  occasion: string
  suggestions: SuggestedOutfit[]
  /** Hubo prioritarias elegibles ese día. */
  hadPriority: boolean
  priorityOk: boolean[]
}

/**
 * Simula 30 días como Hoy: cada día una ocasión (rotando las 6), pide sugerencias con los usos reales
 * de los últimos 60 días y lo usado en los últimos 14, y se pone la PRIMERA sugerencia.
 * `rotation: false` es la línea base: el motor no ve los usos (todo cuenta como "nunca usado"), solo evita repetir.
 */
async function simulate(opts: { mode: 'rules' | 'ai'; rotation: boolean }) {
  const worn: WearRecord[] = []
  const log: DayLog[] = []
  for (let i = 0; i < DAYS; i++) {
    const today = addDays(START, i)
    const occasion = OCCASIONS[i % OCCASIONS.length]
    const recentOutfits = worn.filter((w) => daysBetween(w.date, today) <= NO_REPEAT_DAYS)
    const ctx = {
      occasion,
      weather: WEATHERS[i % WEATHERS.length],
      garments: wardrobe30,
      wears: opts.rotation ? worn.filter((w) => daysBetween(w.date, today) <= 60) : [],
      recentOutfits,
      today,
    }
    let ai: MockAiProvider | undefined
    if (opts.mode === 'ai') {
      // Respuesta hostil: repite lo ya usado, ids inventados, y un duplicado de una propuesta válida.
      const valid = (await suggestOutfits(ctx)).outfits[0]
      const repeat = recentOutfits.at(-1)
      const outfits = [
        ...(repeat ? [{ garment_ids: repeat.garmentIds, reasoning: 'repetido' }] : []),
        { garment_ids: ['no-existe', 'tampoco'], reasoning: 'inválido' },
        ...(valid ? [{ garment_ids: valid.garmentIds, reasoning: 'válido' }, { garment_ids: [...valid.garmentIds].reverse(), reasoning: 'duplicado' }] : []),
      ]
      ai = new MockAiProvider({ json: { outfits } })
    }
    const res = await suggestOutfits(ctx, ai)
    const plan = buildPlan(ctx)
    log.push({
      date: today,
      occasion,
      suggestions: res.outfits,
      hadPriority: plan.priorityIds.size > 0,
      priorityOk: res.outfits.map((o) =>
        o.garmentIds.some((id) => byId.get(id)!.category !== 'accessory' && plan.priorityIds.has(id)),
      ),
    })
    expect(res.outfits.length, `día ${i + 1} (${occasion}) sin sugerencias`).toBeGreaterThan(0)
    worn.push({ garmentIds: res.outfits[0].garmentIds, date: today })
  }
  return { worn, log }
}

const CORE = ['top', 'bottom', 'shoes'] as const
function coverage(worn: WearRecord[]) {
  const used = new Set(worn.flatMap((w) => w.garmentIds))
  const core = wardrobe30.filter((g) => (CORE as readonly string[]).includes(g.category))
  return { ratio: core.filter((g) => used.has(g.id)).length / core.length, total: core.length }
}

describe('aceptación fase 4: 30 días simulados', () => {
  const baseline = simulate({ mode: 'rules', rotation: false })

  for (const mode of ['rules', 'ai'] as const) {
    describe(`modo ${mode}`, () => {
      const run = simulate({ mode, rotation: true })

      it('(a) ningún outfit usado se repite dentro de 14 días', async () => {
        const { worn } = await run
        expect(worn).toHaveLength(DAYS)
        for (let i = 0; i < worn.length; i++) {
          for (let j = i + 1; j < worn.length; j++) {
            if (daysBetween(worn[i].date, worn[j].date) > NO_REPEAT_DAYS) continue
            expect(
              comboKey(worn[i].garmentIds, byId),
              `repetido entre ${worn[i].date} y ${worn[j].date}`,
            ).not.toBe(comboKey(worn[j].garmentIds, byId))
          }
        }
      })

      it('(b) cada sugerencia incluye una prioritaria cuando hay alguna elegible', async () => {
        const { log } = await run
        expect(log.some((d) => d.hadPriority)).toBe(true)
        for (const d of log) {
          if (!d.hadPriority) continue
          expect(d.priorityOk, `${d.date} ${d.occasion}`).not.toContain(false)
        }
      })

      it('(c) rota el armario: >= 90% de superior/inferior/calzado usado en 30 días, 10+ puntos sobre la línea base', async () => {
        const { worn } = await run
        const c = coverage(worn)
        const base = coverage((await baseline).worn)
        console.info(`cobertura ${mode}: ${(c.ratio * 100).toFixed(1)}% de ${c.total} (línea base sin rotación: ${(base.ratio * 100).toFixed(1)}%)`)
        // Medido: 100% con rotación vs 78.3% sin ella (determinista).
        expect(c.ratio).toBeGreaterThanOrEqual(0.9)
        expect(c.ratio).toBeGreaterThanOrEqual(base.ratio + 0.1)
      })
    })
  }
})
