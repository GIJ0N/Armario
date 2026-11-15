import { describe, expect, it, vi } from 'vitest'
import { createCutoutFor, generateCutout, queueCutout } from '../src/cutout/pipeline'
import { MockBackgroundRemover } from '../src/cutout/mock'
import { CutoutError } from '../src/cutout/types'
import { fakeRepo } from './fixtures/fakeRepo'

const original = new Blob(['orig'], { type: 'image/jpeg' })
const bbox = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
const crop = vi.fn(async () => new Blob(['crop'], { type: 'image/jpeg' }))

describe('orden de respaldo: máscara → bbox → nada', () => {
  it('con el modelo descargado usa la máscara y no toca el plan B', async () => {
    crop.mockClear()
    const remover = new MockBackgroundRemover({ downloaded: true, engine: 'webgpu' })
    const { result } = await generateCutout(original, { remover, bbox, cropBBox: crop })
    expect(result).toMatchObject({ kind: 'mask', engine: 'webgpu' })
    expect(crop).not.toHaveBeenCalled()
  })

  it('si la máscara falla cae al bbox', async () => {
    const remover = new MockBackgroundRemover({ error: new CutoutError('failed', 'boom') })
    const out = await generateCutout(original, { remover, bbox, cropBBox: crop })
    expect(out.result).toMatchObject({ kind: 'bbox', engine: 'bbox' })
    expect(out.maskError?.message).toBe('boom')
    expect(crop).toHaveBeenCalledWith(original, bbox)
  })

  it('si el modelo no está descargado ni lo intenta ni lo descarga: va directo al bbox', async () => {
    const remover = new MockBackgroundRemover({ downloaded: false })
    const out = await generateCutout(original, { remover, bbox, cropBBox: crop })
    expect(out.result?.kind).toBe('bbox')
    expect(out.maskSkipped).toBe(true)
    expect(remover.removeCalls).toHaveLength(0)
    expect(remover.readyCalls).toBe(0)
  })

  it('sin modelo y sin bbox no hay recorte', async () => {
    const remover = new MockBackgroundRemover({ downloaded: false })
    const out = await generateCutout(original, { remover, cropBBox: crop })
    expect(out).toMatchObject({ result: null, maskSkipped: true })
  })

  it('la máscara falla y no hay bbox: sin recorte y con el error', async () => {
    const remover = new MockBackgroundRemover({ error: new Error('x') })
    const out = await generateCutout(original, { remover, cropBBox: crop })
    expect(out.result).toBeNull()
    expect(out.maskError).toBeInstanceOf(Error)
  })

  it('si el bbox tampoco se puede recortar, no hay recorte', async () => {
    const remover = new MockBackgroundRemover({ downloaded: false })
    const out = await generateCutout(original, { remover, bbox, cropBBox: async () => Promise.reject(new Error('canvas')) })
    expect(out.result).toBeNull()
  })

  it('el tiempo límite descarta el worker y pasa al bbox', async () => {
    const remover = new MockBackgroundRemover({ delayMs: 80 })
    const out = await generateCutout(original, { remover, bbox, cropBBox: crop, timeoutMs: 10 })
    expect(out.maskError).toMatchObject({ code: 'timeout' })
    expect(remover.disposeCalls).toBe(1)
    expect(out.result?.kind).toBe('bbox')
  })
})

async function repoWithGarment(photo = 'photo:1') {
  const repo = fakeRepo([])
  repo.getPhoto = async () => new Blob(['photo'], { type: 'image/jpeg' })
  const g = await repo.create({ category: 'top', formality: 3, warmth: 2, photo_path: photo })
  return { repo, g }
}

describe('createCutoutFor / queueCutout', () => {
  it('guarda la máscara en la prenda', async () => {
    const { repo, g } = await repoWithGarment()
    const out = await createCutoutFor(repo, g, { remover: new MockBackgroundRemover() })
    expect(out.garment).toMatchObject({ cutout_kind: 'mask' })
    expect(repo.garments[0].cutout_path).toBeTruthy()
  })

  it('una prenda sin foto se deja igual', async () => {
    const repo = fakeRepo([])
    const g = await repo.create({ category: 'top', formality: 3, warmth: 2 })
    const out = await createCutoutFor(repo, g, { remover: new MockBackgroundRemover() })
    expect(out.result).toBeNull()
    expect(repo.garments[0].cutout_path).toBeUndefined()
  })

  it('en segundo plano: sin modelo y sin bbox no cambia nada y no lanza', async () => {
    const { repo, g } = await repoWithGarment()
    const remover = new MockBackgroundRemover({ downloaded: false })
    await expect(queueCutout(repo, remover, g)).resolves.toBeUndefined()
    expect(repo.garments[0].cutout_path).toBeUndefined()
    expect(remover.readyCalls).toBe(0)
  })

  it('en segundo plano: los errores del modelo se ignoran', async () => {
    const { repo, g } = await repoWithGarment()
    const remover = new MockBackgroundRemover({ error: new Error('boom') })
    await expect(queueCutout(repo, remover, g)).resolves.toBeUndefined()
    expect(repo.garments[0].cutout_path).toBeUndefined()
  })
})
