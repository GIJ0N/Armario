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
