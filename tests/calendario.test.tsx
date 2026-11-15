import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeRepo } from './fixtures/fakeRepo'
import { COMBOS, freezeToday, makeOutfit, renderApp, stubNetwork, TODAY } from './fixtures/calendarHelpers'

beforeEach(() => {
  localStorage.clear()
  freezeToday()
  stubNetwork()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const cell = (date: string) => document.querySelector<HTMLElement>(`.cal-cell[data-date="${date}"]`)!
const dayButtons = () => document.querySelectorAll('.cal-cell')

async function openCalendar(repo = fakeRepo()) {
  renderApp(repo, '/calendario')
  await screen.findByRole('grid')
  await waitFor(() => expect(dayButtons().length).toBe(30))
  return repo
}

/** Un día usado ayer (17), uno planeado mañana (19) y hoy con las dos cosas. */
async function seeded() {
  const repo = fakeRepo()
  const worn = await makeOutfit(repo, COMBOS.a, { saved: 'Look de ayer' })
  const planned = await makeOutfit(repo, COMBOS.b, { saved: 'Look de mañana' })
  const todayOne = await makeOutfit(repo, COMBOS.c, { occasion: 'office' })
  await repo.wears.create(worn.id, '2026-11-17')
  await repo.plans.create(planned.id, '2026-11-19', 'office')
  await repo.wears.create(todayOne.id, TODAY)
  await repo.plans.create(planned.id, TODAY, 'office')
  await openCalendar(repo)
  return { repo, worn, planned, todayOne }
}

describe('Calendario: mes', () => {
  it('muestra noviembre 2026 con lunes primero y roles de cuadrícula', async () => {
    await openCalendar()
    expect(screen.getByTestId('month-title')).toHaveTextContent('Noviembre 2026')
    const grid = screen.getByRole('grid', { name: 'Noviembre 2026' })
    const heads = within(grid).getAllByRole('columnheader')
    expect(heads.map((h) => h.getAttribute('aria-label'))).toEqual(['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])
    expect(heads[0]).toHaveTextContent('L')
    // 1 de noviembre es domingo: 6 celdas de relleno antes (sin botones) y el 1 va en la última columna de la primera fila.
    const firstRow = within(grid).getAllByRole('row')[1]
    const cells = within(firstRow).getAllByRole('gridcell', { hidden: true })
    expect(cells).toHaveLength(7)
    expect(cells.slice(0, 6).every((c) => c.querySelector('button') === null)).toBe(true)
    expect(cells[6].querySelector('button')).toHaveAttribute('data-date', '2026-11-01')
    expect(cell(TODAY)).toHaveAttribute('aria-current', 'date')
    expect(cell('2026-11-17')).not.toHaveAttribute('aria-current')
    expect(cell(TODAY)).toHaveAccessibleName('miércoles 18 de noviembre, hoy, sin outfit')
  })

  it('cada día tiene su etiqueta con lo usado y lo planeado, y la celda distingue los estados', async () => {
    await seeded()
    expect(cell('2026-11-17')).toHaveAccessibleName('martes 17 de noviembre, 1 outfit usado')
    expect(cell('2026-11-17')).toHaveAttribute('data-state', 'worn')
    expect(cell('2026-11-19')).toHaveAccessibleName('jueves 19 de noviembre, 1 planeado')
    expect(cell('2026-11-19')).toHaveAttribute('data-state', 'planned')
    expect(cell(TODAY)).toHaveAccessibleName('miércoles 18 de noviembre, hoy, 1 outfit usado, 1 planeado')
    expect(cell(TODAY)).toHaveAttribute('data-today')
    expect(cell(TODAY).querySelector('.cal-more')).toHaveTextContent('+1')
    expect(cell('2026-11-20')).toHaveAttribute('data-state', 'empty')
    // Miniatura: hasta 4 prendas del outfit.
    expect(cell('2026-11-17').querySelectorAll('.thumb-cell')).toHaveLength(3)
    // Cada día es un objetivo táctil de al menos 44 px (altura mínima en CSS; aquí se comprueba que son botones reales).
    expect(cell('2026-11-17').tagName).toBe('BUTTON')
  })

  it('anterior, siguiente y Hoy cambian de mes', async () => {
    const user = userEvent.setup()
    await openCalendar()
    const hoy = screen.getByRole('button', { name: 'Hoy' })
    expect(hoy).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(screen.getByTestId('month-title')).toHaveTextContent('Diciembre 2026')
    await waitFor(() => expect(dayButtons().length).toBe(31))
    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }))
    expect(screen.getByTestId('month-title')).toHaveTextContent('Enero 2027')
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }))
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }))
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }))
    expect(screen.getByTestId('month-title')).toHaveTextContent('Octubre 2026')
    await user.click(screen.getByRole('button', { name: 'Hoy' }))
    expect(screen.getByTestId('month-title')).toHaveTextContent('Noviembre 2026')
    await waitFor(() => expect(dayButtons().length).toBe(30))
  })

  it('deslizar a la izquierda abre el mes siguiente y a la derecha el anterior; un toque corto no cambia', async () => {
    await openCalendar()
    const drag = (dx: number, dy = 0) => {
      const swipe = screen.getByTestId('month-swipe')
      fireEvent.pointerDown(swipe, { pointerId: 1, clientX: 200, clientY: 300 })
      fireEvent.pointerUp(swipe, { pointerId: 1, clientX: 200 + dx, clientY: 300 + dy })
    }
    drag(-120)
    expect(screen.getByTestId('month-title')).toHaveTextContent('Diciembre 2026')
    drag(40)
    expect(screen.getByTestId('month-title')).toHaveTextContent('Diciembre 2026')
    drag(120, 150) // más vertical que horizontal: es un desplazamiento de la página
    expect(screen.getByTestId('month-title')).toHaveTextContent('Diciembre 2026')
    drag(120)
    expect(screen.getByTestId('month-title')).toHaveTextContent('Noviembre 2026')
  })

  it('el teclado mueve entre días: flechas, Inicio/Fin, y cruza el mes', async () => {
    const user = userEvent.setup()
    await openCalendar()
    cell(TODAY).focus()
    await user.keyboard('{ArrowRight}')
    expect(cell('2026-11-19')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(cell('2026-11-26')).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowUp}')
    expect(cell('2026-11-18')).toHaveFocus()
    await user.keyboard('{End}')
    expect(cell('2026-11-22')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(cell('2026-11-16')).toHaveFocus()
    // Solo la celda activa está en el orden de tabulación.
    expect([...dayButtons()].filter((b) => b.getAttribute('tabindex') === '0')).toHaveLength(1)
    // Fin de mes: 30 de noviembre + flecha derecha = 1 de diciembre.
    cell('2026-11-30').focus()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(screen.getByTestId('month-title')).toHaveTextContent('Diciembre 2026'))
    await waitFor(() => expect(cell('2026-12-01')).toHaveFocus())
    await user.keyboard('{PageUp}')
    await waitFor(() => expect(screen.getByTestId('month-title')).toHaveTextContent('Noviembre 2026'))
    await waitFor(() => expect(cell('2026-11-01')).toHaveFocus())
  })

  it('la pestaña Hoy sigue activa en /calendario y hay accesos desde Yo y Uso', async () => {
    const user = userEvent.setup()
    await openCalendar()
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' })
    expect(within(nav).getAllByRole('link')).toHaveLength(5)
    expect(within(nav).getByRole('link', { name: 'Hoy' })).toHaveClass('active')
    expect(within(nav).getByRole('link', { name: 'Yo' })).not.toHaveClass('active')
    await user.click(within(nav).getByRole('link', { name: 'Yo' }))
    await user.click(await screen.findByRole('link', { name: /^Calendario/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendario' })).toBeInTheDocument()
  })
})

describe('Calendario: hoja del día', () => {
  it('abre con el título del día y sus outfits usados y planeados', async () => {
    const user = userEvent.setup()
    await seeded()
    await user.click(cell(TODAY))
    const sheet = await screen.findByRole('dialog', { name: 'Miércoles 18 de noviembre' })
    const entries = within(sheet).getAllByTestId('day-entry')
    expect(entries.map((e) => e.getAttribute('data-kind'))).toEqual(['wear', 'plan'])
    expect(within(entries[0]).getByTestId('entry-state')).toHaveTextContent('Usado')
    expect(within(entries[1]).getByTestId('entry-state')).toHaveTextContent('Planeado')
    expect(within(entries[1]).getByTestId('entry-name')).toHaveTextContent('Look de mañana')
    expect(entries[0].querySelector('.mannequin')).toBeInTheDocument()
    // Temperatura del pronóstico de hoy.
    expect(within(sheet).getByTestId('day-weather')).toHaveTextContent('Hoy · 17° a 27° · lluvia 5%')
  })

  it('«Quitar del día» deshace el uso, avisa y actualiza la celda; el foco vuelve al día', async () => {
    const user = userEvent.setup()
    const { repo } = await seeded()
    await user.click(cell('2026-11-17'))
    const sheet = await screen.findByRole('dialog', { name: 'Martes 17 de noviembre' })
    expect(within(sheet).queryByRole('button', { name: 'Guardar outfit' })).not.toBeInTheDocument() // ya está guardado
    await user.click(within(sheet).getByRole('button', { name: 'Quitar del día' }))
    expect(await screen.findByText('Uso quitado del día')).toBeInTheDocument()
    expect(repo.savedWears.find((w) => w.date === '2026-11-17')).toBeUndefined()
    await waitFor(() => expect(cell('2026-11-17')).toHaveAttribute('data-state', 'empty'))
    expect(within(sheet).getByText('No registraste ningún outfit este día.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Cerrar' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(cell('2026-11-17')).toHaveFocus())
  })

  it('Escape cierra la hoja y devuelve el foco al día', async () => {
    const user = userEvent.setup()
    await seeded()
    await user.click(cell('2026-11-20'))
    await screen.findByRole('dialog', { name: 'Viernes 20 de noviembre' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(cell('2026-11-20')).toHaveFocus())
  })

  it('un uso de un outfit sin guardar ofrece «Guardar outfit» y lo guarda con nombre', async () => {
    const user = userEvent.setup()
    const { repo, todayOne } = await seeded()
    await user.click(cell(TODAY))
    const sheet = await screen.findByRole('dialog', { name: 'Miércoles 18 de noviembre' })
    const wearCard = within(sheet).getAllByTestId('day-entry')[0]
    await user.click(within(wearCard).getByRole('button', { name: 'Guardar outfit' }))
    const save = await screen.findByRole('dialog', { name: 'Guardar outfit' })
    await user.type(within(save).getByLabelText('Nombre (opcional)'), 'Oficina del miércoles')
    await user.click(within(save).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Outfit guardado en Armario › Outfits')).toBeInTheDocument()
    expect(repo.saved.find((o) => o.id === todayOne.id)).toMatchObject({ name: 'Oficina del miércoles' })
    const back = await screen.findByRole('dialog', { name: 'Miércoles 18 de noviembre' })
    await waitFor(() => expect(within(within(back).getAllByTestId('day-entry')[0]).queryByRole('button', { name: 'Guardar outfit' })).not.toBeInTheDocument())
  })

  it('«Me lo puse» convierte el plan de hoy en uso (una sola transacción) y «Quitar del plan» lo borra', async () => {
    const user = userEvent.setup()
    const { repo, planned } = await seeded()
    // Hoy: el plan se convierte en uso.
    await user.click(cell(TODAY))
    let sheet = await screen.findByRole('dialog', { name: 'Miércoles 18 de noviembre' })
    const planCard = within(sheet).getAllByTestId('day-entry')[1]
    await user.click(within(planCard).getByRole('button', { name: 'Me lo puse' }))
    expect(await screen.findByText('Outfit marcado como usado')).toBeInTheDocument()
    expect(repo.planRows.find((p) => p.date === TODAY)).toBeUndefined()
    expect(repo.savedWears.filter((w) => w.date === TODAY).map((w) => w.outfit_id)).toContain(planned.id)
    await waitFor(() => expect(cell(TODAY)).toHaveAccessibleName('miércoles 18 de noviembre, hoy, 2 outfits usados'))
    await user.click(within(sheet).getByRole('button', { name: 'Cerrar' }))

    // Mañana: no se puede marcar todavía; «Quitar del plan» sí.
    await user.click(cell('2026-11-19'))
    sheet = await screen.findByRole('dialog', { name: 'Jueves 19 de noviembre' })
    expect(within(sheet).getByRole('button', { name: 'Me lo puse' })).toBeDisabled()
    expect(within(sheet).getByText('Podrás marcarlo ese día.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Quitar del plan' }))
    expect(await screen.findByText('Quitado del plan')).toBeInTheDocument()
    expect(repo.planRows).toHaveLength(0)
    await waitFor(() => expect(cell('2026-11-19')).toHaveAttribute('data-state', 'empty'))
  })

  it('«Agregar outfit» → guardados: en un día futuro queda planeado y en uno pasado queda como usado', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    const saved = await makeOutfit(repo, COMBOS.b, { saved: 'Mi look de oficina', occasion: 'office' })
    await openCalendar(repo)

    // Futuro: planeado.
    await user.click(cell('2026-11-25'))
    let sheet = await screen.findByRole('dialog', { name: 'Miércoles 25 de noviembre' })
    await user.click(within(sheet).getByRole('button', { name: 'Agregar outfit' }))
    sheet = await screen.findByRole('dialog', { name: 'Agregar outfit' })
    expect(sheet).toHaveTextContent('Quedará planeado')
    await user.click(within(sheet).getByRole('button', { name: 'Elegir de mis guardados' }))
    sheet = await screen.findByRole('dialog', { name: 'Mis outfits guardados' })
    const item = within(sheet).getByTestId('pick-saved')
    expect(item).toHaveTextContent('Mi look de oficina')
    expect(item.querySelector('.mannequin')).toBeInTheDocument()
    await user.click(within(item).getByRole('button', { name: 'Elegir' }))
    expect(await screen.findByText('Outfit planeado')).toBeInTheDocument()
    expect(repo.planRows).toMatchObject([{ outfitId: saved.id, date: '2026-11-25', occasion: 'office' }])
    expect(repo.savedWears).toHaveLength(0)
    await waitFor(() => expect(cell('2026-11-25')).toHaveAttribute('data-state', 'planned'))
    const back = await screen.findByRole('dialog', { name: 'Miércoles 25 de noviembre' })
    expect(within(back).getByTestId('entry-name')).toHaveTextContent('Mi look de oficina')
    await user.click(within(back).getByRole('button', { name: 'Cerrar' }))

    // Pasado («se me olvidó marcarlo»): uso registrado en esa fecha.
    await user.click(cell('2026-11-09'))
    sheet = await screen.findByRole('dialog', { name: 'Lunes 9 de noviembre' })
    expect(sheet).toHaveTextContent('No registraste ningún outfit este día.')
    await user.click(within(sheet).getByRole('button', { name: 'Agregar outfit' }))
    await user.click(await screen.findByRole('button', { name: 'Elegir de mis guardados' }))
    await user.click(within(await screen.findByTestId('pick-saved')).getByRole('button', { name: 'Elegir' }))
    expect(await screen.findByText('Uso registrado en el calendario')).toBeInTheDocument()
    expect(repo.savedWears).toMatchObject([{ outfit_id: saved.id, date: '2026-11-09' }])
    await waitFor(() => expect(cell('2026-11-09')).toHaveAttribute('data-state', 'worn'))
    expect(cell('2026-11-09')).toHaveAccessibleName('lunes 9 de noviembre, 1 outfit usado')
  })

  it('«Agregar outfit» → hoy se registra como usado hoy', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    const saved = await makeOutfit(repo, COMBOS.a, { saved: 'Look casual' })
    await openCalendar(repo)
    await user.click(cell(TODAY))
    await user.click(await screen.findByRole('button', { name: 'Agregar outfit' }))
    await user.click(await screen.findByRole('button', { name: 'Elegir de mis guardados' }))
    await user.click(within(await screen.findByTestId('pick-saved')).getByRole('button', { name: 'Elegir' }))
    expect(await screen.findByText('Outfit marcado como usado hoy')).toBeInTheDocument()
    expect(repo.savedWears).toMatchObject([{ outfit_id: saved.id, date: TODAY }])
  })

  it('«Sugerir» para un día con pronóstico usa el motor y deja elegir uno de los 3', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    await openCalendar(repo)
    await user.click(cell('2026-11-20'))
    await user.click(await screen.findByRole('button', { name: 'Agregar outfit' }))
    await user.click(await screen.findByRole('button', { name: 'Sugerir' }))
    const sheet = await screen.findByRole('dialog', { name: 'Sugerir outfits' })
    expect(within(sheet).getByTestId('suggest-weather')).toHaveTextContent('Pronóstico: 16° a 26° · lluvia 20%')
    await user.click(within(sheet).getByRole('button', { name: 'Casual' }))
    await user.click(within(sheet).getByRole('button', { name: 'Sugerir' }))
    const options = await within(sheet).findAllByTestId('suggested-outfit')
    expect(options).toHaveLength(3)
    await user.click(within(options[0]).getByRole('button', { name: 'Elegir este' }))
    expect(await screen.findByText('Outfit planeado')).toBeInTheDocument()
    expect(repo.saved).toHaveLength(1) // solo se guarda el elegido
    expect(repo.saved[0]).toMatchObject({ occasion: 'casual', source: 'rules' })
    expect(repo.saved[0].weather_snapshot).toMatchObject({ tempMaxC: 26, precipProbability: 20 })
    expect(repo.planRows).toMatchObject([{ outfitId: repo.saved[0].id, date: '2026-11-20', occasion: 'casual' }])
  })

  it('«Sugerir» fuera del rango del pronóstico avisa «sin pronóstico: clima templado»', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    await openCalendar(repo)
    await user.click(cell('2026-11-27'))
    await user.click(await screen.findByRole('button', { name: 'Agregar outfit' }))
    await user.click(await screen.findByRole('button', { name: 'Sugerir' }))
    const sheet = await screen.findByRole('dialog', { name: 'Sugerir outfits' })
    expect(within(sheet).getByTestId('suggest-weather')).toHaveTextContent(/sin pronóstico: clima templado/i)
    await user.click(within(sheet).getByRole('button', { name: 'Sugerir' }))
    const options = await within(sheet).findAllByTestId('suggested-outfit')
    await user.click(within(options[1]).getByRole('button', { name: 'Elegir este' }))
    await screen.findByText('Outfit planeado')
    expect(repo.saved[0].weather_snapshot).toMatchObject({ tempC: 22 }) // el clima templado neutro
  })

  it('sin conexión ni caché el calendario funciona y el día sin pronóstico lo dice', async () => {
    const user = userEvent.setup()
    stubNetwork(false)
    await openCalendar()
    await user.click(cell('2026-11-20'))
    const sheet = await screen.findByRole('dialog', { name: 'Viernes 20 de noviembre' })
    expect(within(sheet).getByTestId('day-weather')).toHaveTextContent('Sin pronóstico: clima templado')
  })

  it('tocar una prenda de un outfit planeado abre «Cambiar» y mueve el plan si el outfit tiene historia', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    const planned = await makeOutfit(repo, COMBOS.b, { saved: 'Look de oficina', occasion: 'office' })
    await repo.wears.create(planned.id, '2026-11-10') // con historia: no se reescribe
    await repo.plans.create(planned.id, '2026-11-24', 'office')
    await openCalendar(repo)
    await user.click(cell('2026-11-24'))
    const sheet = await screen.findByRole('dialog', { name: 'Martes 24 de noviembre' })
    const card = within(sheet).getByTestId('day-entry')
    await user.click(within(card).getAllByRole('button', { name: 'camisa oxford' })[0])
    const swap = await screen.findByRole('dialog', { name: 'Cambiar camisa oxford' })
    const options = within(swap).getAllByTestId('alt-valid')
    expect(options.length).toBeGreaterThan(0)
    await user.click(options[0])
    expect(await screen.findByText(/Cambiaste camisa oxford por/)).toBeInTheDocument()
    expect(repo.planRows).toHaveLength(1)
    expect(repo.planRows[0].outfitId).not.toBe(planned.id)
    const newOutfit = repo.saved.find((o) => o.id === repo.planRows[0].outfitId)!
    expect(newOutfit.garment_ids).not.toContain('top-oxford-azul')
    expect(newOutfit.saved_at).toBeTruthy() // el guardado pasa a la fila nueva
    // La original conserva su uso del día 10.
    expect(repo.savedWears).toMatchObject([{ outfit_id: planned.id, date: '2026-11-10' }])
  })

  it('«Cambiar» en un uso abre el editor y mueve el uso a la fila nueva', async () => {
    const user = userEvent.setup()
    const repo = fakeRepo()
    const worn = await makeOutfit(repo, COMBOS.b, { saved: 'Look de oficina', occasion: 'office' })
    await repo.wears.create(worn.id, '2026-11-12')
    await openCalendar(repo)
    await user.click(cell('2026-11-12'))
    const sheet = await screen.findByRole('dialog', { name: 'Jueves 12 de noviembre' })
    await user.click(within(sheet).getByRole('button', { name: 'Cambiar' }))
    const editor = await screen.findByRole('dialog', { name: 'Cambiar outfit' })
    await user.click(within(editor).getByRole('button', { name: 'Cambiar camisa oxford' }))
    const picker = await screen.findByRole('dialog', { name: 'Cambiar camisa oxford' })
    await user.click(within(picker).getAllByTestId('alt-valid')[0])
    await user.click(await within(await screen.findByRole('dialog', { name: 'Cambiar outfit' })).findByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByText('Outfit actualizado')).toBeInTheDocument()
    expect(repo.savedWears).toHaveLength(1)
    expect(repo.savedWears[0].date).toBe('2026-11-12')
    expect(repo.savedWears[0].outfit_id).not.toBe(worn.id)
    expect(repo.saved.find((o) => o.id === repo.savedWears[0].outfit_id)?.garment_ids).not.toContain('top-oxford-azul')
  })

  it('una acción fallida muestra el error y no cierra la hoja', async () => {
    const user = userEvent.setup()
    const { repo } = await seeded()
    vi.spyOn(repo.wears, 'deleteForOutfitOnDate').mockRejectedValueOnce(new Error('Falló la base'))
    await user.click(cell('2026-11-17'))
    const sheet = await screen.findByRole('dialog', { name: 'Martes 17 de noviembre' })
    await user.click(within(sheet).getByRole('button', { name: 'Quitar del día' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Falló la base')
    expect(cell('2026-11-17')).toHaveAttribute('data-state', 'worn')
  })

  it('al deslizar sobre un día no se abre su hoja', async () => {
    await openCalendar()
    const swipe = screen.getByTestId('month-swipe')
    const target = cell('2026-11-10')
    await act(async () => {
      fireEvent.pointerDown(target, { pointerId: 1, clientX: 300, clientY: 200 })
      fireEvent.pointerUp(target, { pointerId: 1, clientX: 100, clientY: 205 })
      fireEvent.click(target)
    })
    expect(swipe).toBeInTheDocument()
    expect(screen.getByTestId('month-title')).toHaveTextContent('Diciembre 2026')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
