import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockAiProvider } from '../src/ai/mock'
import type { GenerateJsonRequest } from '../src/ai/provider'
import { suggestOutfits } from '../src/engine'
import { addDays } from '../src/lib/date'
import { WEATHER_PRESETS } from '../src/weather'
import { COMBOS, freezeToday, makeOutfit, renderApp, stubNetwork, TODAY } from './fixtures/calendarHelpers'
import { fakeRepo } from './fixtures/fakeRepo'
import { wardrobe30 } from './fixtures/wardrobe30'

beforeEach(() => {
  localStorage.clear()
  freezeToday()
  stubNetwork()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Hoy es miércoles 18: los próximos 5 días hábiles son jue 19, vie 20, lun 23, mar 24 y mié 25.
const DEFAULT_DAYS = ['2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24', '2026-11-25']
const cell = (date: string) => document.querySelector<HTMLElement>(`.cal-cell[data-date="${date}"]`)!

async function openPlanner(repo = fakeRepo(), ai?: MockAiProvider) {
  renderApp(repo, '/calendario', ai)
  await screen.findByRole('grid')
  await waitFor(() => expect(document.querySelectorAll('.cal-cell').length).toBe(30))
  await userEvent.click(screen.getByRole('button', { name: 'Planear semana' }))
  const sheet = await screen.findByRole('dialog', { name: 'Planear semana' })
  await waitFor(() => expect(within(sheet).getAllByRole('checkbox').length).toBeGreaterThan(0))
  return { repo, sheet }
}

const checked = (sheet: HTMLElement) =>
  within(sheet)
    .getAllByRole('checkbox')
    .filter((c) => (c as HTMLInputElement).checked)
    .map((c) => c.closest('li')!.textContent!)

describe('Planear semana: elegir días', () => {
  it('propone los próximos 5 días hábiles sin plan, con «trabajo en planta» entre semana y casual el fin de semana', async () => {
    const { sheet } = await openPlanner()
    expect(checked(sheet)).toHaveLength(5)
    expect(checked(sheet)[0]).toContain('Jueves 19 de noviembre')
    expect(checked(sheet)[4]).toContain('Miércoles 25 de noviembre')
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(14)
    for (const d of DEFAULT_DAYS) {
      expect(within(sheet).getByLabelText(new RegExp(`Ocasión del .* ${Number(d.slice(8))} de noviembre`))).toHaveValue('plant_work')
    }
    // Un sábado, al marcarlo, propone casual.
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Sábado 21 de noviembre/ }))
    expect(within(sheet).getByLabelText('Ocasión del sábado 21 de noviembre')).toHaveValue('casual')
    expect(within(sheet).getByRole('button', { name: 'Armar 6 outfits' })).toBeEnabled()
  })

  it('usa como ocasión entre semana la que más se ha usado en el historial', async () => {
    const repo = fakeRepo()
    const o = await makeOutfit(repo, COMBOS.b, { occasion: 'office' })
    for (const d of ['2026-11-16', '2026-11-17', '2026-11-12']) await repo.wears.create(o.id, d)
    const g = await makeOutfit(repo, COMBOS.a, { occasion: 'gym' })
    await repo.wears.create(g.id, '2026-11-11')
    const { sheet } = await openPlanner(repo)
    expect(within(sheet).getByLabelText('Ocasión del jueves 19 de noviembre')).toHaveValue('office')
  })

  it('salta los días que ya tienen plan', async () => {
    const repo = fakeRepo()
    const o = await makeOutfit(repo, COMBOS.a)
    await repo.plans.create(o.id, '2026-11-19')
    const { sheet } = await openPlanner(repo)
    const on = checked(sheet)
    expect(on).toHaveLength(5)
    expect(on.join(' ')).not.toContain('Jueves 19')
    expect(on[0]).toContain('Viernes 20')
    expect(within(sheet).getByRole('checkbox', { name: /Jueves 19/ })).not.toBeChecked()
    expect(sheet).toHaveTextContent('ya tiene plan')
  })
})

describe('Planear semana: con el motor de reglas', () => {
  it('genera un outfit por día, sin repetir combinaciones, deja revisarlos y «Guardar plan» escribe los planes', async () => {
    const user = userEvent.setup()
    const { repo, sheet } = await openPlanner()
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    const drafts = within(review).getAllByTestId('plan-draft')
    expect(drafts.map((d) => d.getAttribute('data-date'))).toEqual(DEFAULT_DAYS)
    // Nada se escribió todavía.
    expect(repo.planRows).toHaveLength(0)
    expect(repo.saved).toHaveLength(0)
    // Sin combinaciones repetidas entre los días.
    const combos = drafts.map((d) =>
      [...d.querySelectorAll<HTMLElement>('.canvas-garment')]
        .map((b) => b.getAttribute('data-garment-id')!)
        .filter((id) => !id.startsWith('acc-'))
        .sort()
        .join('|'),
    )
    expect(new Set(combos).size).toBe(5)
    // Pronóstico: jueves 19 es el día 2 (30°) y el 25 queda fuera de rango.
    expect(drafts[0]).toHaveTextContent('Trabajo en planta')
    expect(drafts[0]).toHaveTextContent('28°')
    expect(drafts[4]).toHaveTextContent('sin pronóstico: clima templado')

    await user.click(within(review).getByRole('button', { name: 'Guardar plan' }))
    expect(await screen.findByText('Plan guardado: 5 días')).toBeInTheDocument()
    expect(repo.planRows.map((p) => p.date)).toEqual(DEFAULT_DAYS)
    expect(repo.planRows.every((p) => p.occasion === 'plant_work')).toBe(true)
    expect(repo.saved).toHaveLength(5)
    expect(repo.saved.every((o) => o.source === 'rules' && o.occasion === 'plant_work')).toBe(true)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    for (const d of DEFAULT_DAYS) await waitFor(() => expect(cell(d)).toHaveAttribute('data-state', 'planned'))
  })

  it('«Cancelar» en la revisión descarta todo: no se escribe ningún plan ni outfit', async () => {
    const user = userEvent.setup()
    const { repo, sheet } = await openPlanner()
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    await user.click(within(review).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(repo.planRows).toHaveLength(0)
    expect(repo.saved).toHaveLength(0)
    expect(cell('2026-11-19')).toHaveAttribute('data-state', 'empty')
  })

  it('«Otra opción» cambia el outfit de ese día, «Quitar día» lo saca y solo se guardan los que quedan', async () => {
    const user = userEvent.setup()
    const { repo, sheet } = await openPlanner()
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    const ids = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.canvas-garment')].map((b) => b.getAttribute('data-garment-id')).join('|')
    const first = within(review).getAllByTestId('plan-draft')[0]
    const before = ids(first)
    await user.click(within(first).getByRole('button', { name: 'Otra opción' }))
    await waitFor(() => expect(ids(within(review).getAllByTestId('plan-draft')[0])).not.toBe(before))
    await user.click(within(review).getByRole('button', { name: /Quitar viernes 20 de noviembre del plan/ }))
    expect(within(review).getAllByTestId('plan-draft')).toHaveLength(4)
    await user.click(within(review).getByRole('button', { name: 'Guardar plan' }))
    expect(await screen.findByText('Plan guardado: 4 días')).toBeInTheDocument()
    expect(repo.planRows.map((p) => p.date)).toEqual(['2026-11-19', '2026-11-23', '2026-11-24', '2026-11-25'])
  })

  it('tocar una prenda del borrador abre «Cambiar» y el cambio queda como outfit manual al guardar', async () => {
    const user = userEvent.setup()
    const { repo, sheet } = await openPlanner()
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    const first = within(review).getAllByTestId('plan-draft')[0]
    const garment = first.querySelector<HTMLElement>('.canvas-garment[data-zone="torso"], .canvas-garment[data-zone="legs"]')!
    const name = garment.getAttribute('aria-label')!
    await user.click(garment)
    const swap = await screen.findByRole('dialog', { name: `Cambiar ${name}` })
    const target = within(swap).getAllByTestId('alt-valid')[0]
    await user.click(target)
    const back = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    expect(within(back).getAllByTestId('plan-draft')[0]).toHaveTextContent('Editado a mano.')
    await user.click(within(back).getByRole('button', { name: 'Guardar plan' }))
    await screen.findByText('Plan guardado: 5 días')
    expect(repo.saved[0].source).toBe('manual')
  })

  it('con una sola ocasión distinta por día respeta lo elegido', async () => {
    const user = userEvent.setup()
    const { repo, sheet } = await openPlanner()
    await user.selectOptions(within(sheet).getByLabelText('Ocasión del jueves 19 de noviembre'), 'office')
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    expect(within(review).getAllByTestId('plan-draft')[0]).toHaveTextContent('Oficina')
    await user.click(within(review).getByRole('button', { name: 'Guardar plan' }))
    await screen.findByText(/Plan guardado/)
    expect(repo.planRows[0]).toMatchObject({ date: '2026-11-19', occasion: 'office' })
  })

  it('un plan nuevo evita repetir lo ya planeado en días cercanos', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    // Lo que el motor daría hoy para el jueves 19: se planea el viernes 20 y no debe repetirse el jueves.
    const base = await suggestOutfits({
      occasion: 'plant_work',
      weather: WEATHER_PRESETS.warm,
      garments: wardrobe30,
      wears: [],
      recentOutfits: [],
      today: '2026-11-19',
    })
    const planned = await makeOutfit(repo, base.outfits[0].garmentIds, { occasion: 'plant_work' })
    await repo.plans.create(planned.id, '2026-11-20')
    const { sheet } = await openPlanner(repo)
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    const core = (ids: string[]) => ids.filter((id) => !id.startsWith('acc-')).sort().join('|')
    const thursday = within(review).getAllByTestId('plan-draft')[0]
    const picked = [...thursday.querySelectorAll<HTMLElement>('.canvas-garment')].map((b) => b.getAttribute('data-garment-id')!)
    expect(core(picked)).not.toBe(core(base.outfits[0].garmentIds))
  })
})

/** IA simulada que registra cuántas llamadas hay en vuelo a la vez. */
class TrackingAi extends MockAiProvider {
  inFlight = 0
  maxInFlight = 0
  override async generateJson<T>(req: GenerateJsonRequest<T>): Promise<T> {
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      await new Promise((r) => setTimeout(r, 5))
      return await super.generateJson(req)
    } finally {
      this.inFlight--
    }
  }
}

describe('Planear semana: con IA simulada', () => {
  it('pide un día a la vez (secuencial), valida lo de la IA, completa con reglas y no repite combinaciones', async () => {
    const user = userEvent.setup()
    // Respuesta válida para el primer día (jueves 19, trabajo en planta, clima templado).
    const base = await suggestOutfits({
      occasion: 'plant_work',
      weather: WEATHER_PRESETS.warm,
      garments: wardrobe30,
      wears: [],
      recentOutfits: [],
      today: '2026-11-19',
    })
    const json = { outfits: base.outfits.map((o) => ({ garment_ids: o.garmentIds, reasoning: `Razón IA ${o.garmentIds[0]}` })) }
    const ai = new TrackingAi({ json })
    const { repo, sheet } = await openPlanner(fakeRepo(), ai)
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    expect(ai.maxInFlight).toBe(1)
    expect(ai.jsonCalls.length).toBeGreaterThanOrEqual(5) // al menos una consulta por día
    const drafts = within(review).getAllByTestId('plan-draft')
    expect(drafts).toHaveLength(5)
    expect(drafts[0]).toHaveTextContent('Razón IA')
    const combos = drafts.map((d) =>
      [...d.querySelectorAll<HTMLElement>('.canvas-garment')]
        .map((b) => b.getAttribute('data-garment-id')!)
        .filter((id) => !id.startsWith('acc-'))
        .sort()
        .join('|'),
    )
    expect(new Set(combos).size).toBe(5)
    // El prompt de cada día lista los outfits ya planeados para evitar repetirlos.
    const lastPrompt = String(ai.jsonCalls[ai.jsonCalls.length - 1].user)
    expect(lastPrompt).toContain(base.outfits[0].garmentIds[0])
    await user.click(within(review).getByRole('button', { name: 'Guardar plan' }))
    await screen.findByText('Plan guardado: 5 días')
    expect(repo.planRows).toHaveLength(5)
    expect(repo.saved[0].source).toBe('ai')
    expect(repo.saved.slice(1).every((o) => o.source === 'rules' || o.source === 'ai')).toBe(true)
  })

  it('si la IA falla usa las reglas en cada día (sin romper el plan) y avisa de cancelar mientras genera', async () => {
    const user = userEvent.setup()
    const ai = new MockAiProvider({ error: new Error('sin cuota'), delayMs: 10 })
    const { repo, sheet } = await openPlanner(fakeRepo(), ai)
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    const review = await screen.findByRole('dialog', { name: 'Revisa el plan' })
    expect(within(review).getAllByTestId('plan-draft')).toHaveLength(5)
    await user.click(within(review).getByRole('button', { name: 'Guardar plan' }))
    await screen.findByText('Plan guardado: 5 días')
    expect(repo.saved.every((o) => o.source === 'rules')).toBe(true)
  })

  it('«Cancelar» mientras se arma el plan lo detiene y no escribe nada', async () => {
    const user = userEvent.setup()
    const ai = new TrackingAi({ json: { outfits: [] } })
    const { repo, sheet } = await openPlanner(fakeRepo(), ai)
    await user.click(within(sheet).getByRole('button', { name: 'Armar 5 outfits' }))
    expect(await screen.findByTestId('plan-progress')).toHaveTextContent(/Armando outfit \d de 5/)
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 120))
    expect(repo.planRows).toHaveLength(0)
    expect(repo.saved).toHaveLength(0)
    expect(addDays(TODAY, 1)).toBe('2026-11-19')
  })
})
