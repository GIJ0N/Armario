import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

test('agregar, recargar, editar y eliminar una prenda', async ({ page }) => {
  // Imagen de prueba generada al vuelo (2000x1500, para comprobar el redimensionado).
  const file = join(mkdtempSync(join(tmpdir(), 'armario-e2e-')), 'prenda.jpg')
  await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#3355aa' } })
    .jpeg()
    .toFile(file)

  await page.goto('./#/agregar')
  await page.getByTestId('gallery-input').setInputFiles(file)
  await expect(page.getByAltText('Vista previa de la foto')).toBeVisible()
  const size = await page.getByAltText('Vista previa de la foto').evaluate((img: HTMLImageElement) => ({
    w: img.naturalWidth,
    h: img.naturalHeight,
  }))
  expect(Math.max(size.w, size.h)).toBe(1024)
  // Sin API key: aviso hacia Ajustes y el formulario manual sigue funcionando.
  await expect(page.getByText(/agrega tu API key/)).toBeVisible()

  await page.getByLabel('Categoría *').selectOption('top')
  await page.getByLabel('Subcategoría').fill('Camisa azul')
  await page.getByLabel('Formalidad *').selectOption('3')
  await page.getByLabel('Abrigo *').selectOption('2')
  await page.getByRole('button', { name: 'Guardar prenda' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Armario' })).toBeVisible()
  await expect(page.getByText('Camisa azul')).toBeVisible()
  await expect(page.getByTestId('count')).toHaveText('1 prenda')
  await expect(page.locator('.card img.garment-img')).toBeVisible()

  // La prenda y su foto sobreviven a una recarga completa.
  await page.reload()
  await expect(page.getByText('Camisa azul')).toBeVisible()
  await expect(page.getByTestId('count')).toHaveText('1 prenda')
  await expect(page.locator('.card img.garment-img')).toBeVisible()

  // Lavandería con un toque.
  await page.getByRole('button', { name: 'A lavandería' }).click()
  await expect(page.getByRole('button', { name: 'Marcar activa' })).toBeVisible()
  await page.getByRole('button', { name: 'Marcar activa' }).click()

  // Editar.
  await page.getByRole('link', { name: /Editar Camisa azul/ }).click()
  await page.getByLabel('Subcategoría').fill('Camisa blanca')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByText('Camisa blanca')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Camisa blanca')).toBeVisible()

  // Eliminar con el diálogo propio.
  await page.getByRole('link', { name: /Editar Camisa blanca/ }).click()
  await page.getByRole('button', { name: 'Eliminar prenda' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Armario' })).toBeVisible()
  await expect(page.getByText('No hay prendas')).toBeVisible()
  await page.reload()
  await expect(page.getByText('No hay prendas')).toBeVisible()
})

test('Hoy: sin API key sugiere un outfit por reglas con el clima simulado', async ({ page }) => {
  let geminiCalls = 0
  await page.route('**/generativelanguage.googleapis.com/**', (route) => {
    geminiCalls++
    return route.abort()
  })
  await page.route('**/geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({
      json: { results: [{ name: 'Monterrey', latitude: 25.67, longitude: -100.31 }] },
    }),
  )
  await page.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({
      json: {
        current: { temperature_2m: 22, apparent_temperature: 22, precipitation: 0, weather_code: 1 },
        daily: {
          temperature_2m_max: [26],
          temperature_2m_min: [17],
          precipitation_probability_max: [10],
        },
      },
    }),
  )

  for (const [category, name] of [
    ['top', 'Polo e2e'],
    ['bottom', 'Chinos e2e'],
    ['shoes', 'Mocasines e2e'],
  ] as const) {
    await page.goto('./#/agregar')
    await page.getByLabel('Categoría *').selectOption(category)
    await page.getByLabel('Subcategoría').fill(name)
    await page.getByLabel('Formalidad *').selectOption('3')
    await page.getByLabel('Abrigo *').selectOption('2')
    await page.getByRole('button', { name: 'Guardar prenda' }).click()
    await expect(page.getByText(name)).toBeVisible()
  }

  // Antes de usar nada: 0% en Uso y el historial vacío.
  await page.getByRole('link', { name: /Uso/ }).click()
  await expect(page.getByTestId('usage-percent')).toHaveText('0%')
  await expect(page.getByText(/Todavía no has usado ningún outfit/)).toBeVisible()

  await page.getByRole('link', { name: /Hoy/ }).click()
  await expect(page.getByTestId('weather-card')).toContainText('22°')
  await expect(page.getByTestId('weather-card')).toContainText('Lluvia 10%')
  await page.getByRole('button', { name: 'Sugerir outfits' }).click()
  const cards = page.getByTestId('outfit-card')
  await expect(cards.first()).toBeVisible()
  expect(await cards.count()).toBeGreaterThanOrEqual(1)
  await expect(cards.first().getByTestId('source-badge')).toHaveText('reglas')
  await expect(cards.first()).toContainText('Polo e2e')

  // Fase 5: 👎 con «Muy formal», la calificación se guarda y sobrevive a una recarga.
  await cards.first().getByRole('button', { name: 'No me gusta' }).click()
  await cards.first().getByRole('button', { name: 'Muy formal' }).click()
  await cards.first().getByRole('button', { name: 'Guardar calificación' }).click()
  await expect(cards.first().getByTestId('rating-saved')).toContainText('👎 No me gusta · Muy formal')
  await page.reload()
  await page.getByRole('link', { name: /Ajustes/ }).click()
  await expect(page.getByTestId('taste-counts')).toContainText('Calificaciones: 1 (0 me gusta, 1 no me gusta)')
  await page.getByRole('link', { name: /Hoy/ }).click()
  await expect(page.getByTestId('weather-card')).toContainText('22°')
  await page.getByRole('button', { name: 'Sugerir outfits' }).click()
  await expect(cards.first()).toBeVisible()
  await expect(cards.first()).toContainText('Polo e2e')

  // «Me lo pongo» -> aparece en Uso (historial y %), y sobrevive a una recarga.
  await cards.first().getByRole('button', { name: 'Me lo pongo' }).click()
  await expect(cards.first().getByText('Puesto hoy ✓')).toBeVisible()
  await cards.first().getByRole('button', { name: 'Deshacer' }).click()
  await expect(cards.first().getByRole('button', { name: 'Me lo pongo' })).toBeVisible()
  await cards.first().getByRole('button', { name: 'Me lo pongo' }).click()
  await expect(cards.first().getByText('Puesto hoy ✓')).toBeVisible()
  await page.getByRole('link', { name: /Uso/ }).click()
  await expect(page.getByTestId('usage-percent')).toHaveText('100%')
  await expect(page.getByTestId('usage-count')).toHaveText('3 de 3 prendas activas')
  const entry = page.getByTestId('history-entry')
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText('Casual')
  await expect(page.getByTestId('history').getByRole('heading', { level: 3 })).toHaveText('Hoy')
  await expect(page.getByRole('list', { name: 'Más usadas' })).toContainText('Polo e2e')
  await page.reload()
  await expect(page.getByTestId('usage-percent')).toHaveText('100%')
  await expect(page.getByTestId('history-entry')).toHaveCount(1)

  // Con lo ya usado fuera de juego, la única combinación posible no se vuelve a sugerir.
  await page.getByRole('link', { name: /Hoy/ }).click()
  await page.getByRole('button', { name: 'Sugerir outfits' }).click()
  await expect(page.getByText(/No hay más combinaciones nuevas/)).toBeVisible()
  await expect(page.getByTestId('outfit-card')).toHaveCount(0)
  expect(geminiCalls).toBe(0)
})

async function addGarment(page: import('@playwright/test').Page, name: string) {
  await page.goto('./#/agregar')
  await page.getByLabel('Categoría *').selectOption('top')
  await page.getByLabel('Subcategoría').fill(name)
  await page.getByLabel('Formalidad *').selectOption('3')
  await page.getByLabel('Abrigo *').selectOption('2')
  await page.getByRole('button', { name: 'Guardar prenda' }).click()
  await expect(page.getByText(name)).toBeVisible()
}

test('respaldo: exportar, borrar la prenda y restaurar con el zip descargado', async ({ page }) => {
  await addGarment(page, 'Camisa respaldo')
  // Con prendas y sin respaldo previo aparece el recordatorio semanal.
  await expect(page.getByText('Haz tu respaldo semanal')).toBeVisible()

  await page.goto('./#/ajustes')
  await expect(page.getByTestId('last-backup')).toContainText('Nunca')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar respaldo' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^armario-respaldo-\d{4}-\d{2}-\d{2}\.zip$/)
  const zipPath = join(mkdtempSync(join(tmpdir(), 'armario-e2e-')), 'respaldo.zip')
  await download.saveAs(zipPath)
  await expect(page.getByTestId('last-backup')).toContainText('hoy')

  // Borrar la prenda.
  await page.goto('./#/armario')
  await page.getByRole('link', { name: /Editar Camisa respaldo/ }).click()
  await page.getByRole('button', { name: 'Eliminar prenda' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar' }).click()
  await expect(page.getByText('No hay prendas')).toBeVisible()

  // Restaurar.
  await page.goto('./#/ajustes')
  await page.getByTestId('restore-input').setInputFiles(zipPath)
  await expect(page.getByRole('alertdialog')).toContainText('Esto reemplaza tu armario actual')
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar' }).click(),
  ])
  await page.goto('./#/armario')
  await expect(page.getByText('Camisa respaldo')).toBeVisible()
  await expect(page.getByTestId('count')).toHaveText('1 prenda')
})

test('sin conexión: la app instalada abre con su armario', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await addGarment(page, 'Camisa offline')
  // Espera a que el service worker controle la página (precache listo).
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
        void reg.active
        setTimeout(resolve, 5000)
      })
    }
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toBeVisible()
  await expect(page.getByText('Sin conexión')).toBeVisible()
  await page.goto('./#/armario')
  await expect(page.getByText('Camisa offline')).toBeVisible()
  await expect(page.getByTestId('count')).toHaveText('1 prenda')
  // Hoy sin red: sin errores sin capturar.
  await page.goto('./#/')
  await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
  expect(errors).toEqual([])
  await context.setOffline(false)
})
