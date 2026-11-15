import { describe, expect, it, vi } from 'vitest'
import { MockBackgroundRemover } from '../src/cutout'
import { subscribeCutoutChanged } from '../src/cutout/events'
import { detectProvidedCutout, finishCutoutAfterSave, preparePhoto, type PrepareDeps } from '../src/cutout/provided'
import { fakeRepo } from './fixtures/fakeRepo'

function rgbaWith(w: number, h: number, alphaAt: (x: number, y: number) => number) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = alphaAt(x, y)
  return { width: w, height: h, rgba }
}

function deps(img: ReturnType<typeof rgbaWith> | null): PrepareDeps & { encoded: { w: number; h: number }[] } {
  const encoded: { w: number; h: number }[] = []
  return {
    encoded,
    decode: vi.fn(async () => img),
    encodePng: vi.fn(async (_rgba, w, h) => {
      encoded.push({ w, h })
      return new Blob(['png'], { type: 'image/png' })
    }),
    flatten: vi.fn(async () => new Blob(['jpg'], { type: 'image/jpeg' })),
  }
}

const png = new File(['x'], 'a.png', { type: 'image/png' })

describe('preparePhoto / detectProvidedCutout', () => {
  it('con transparencia: recorte PNG al contenido más la foto aplanada', async () => {
    const d = deps(rgbaWith(100, 100, (x, y) => (x >= 20 && x < 80 && y >= 20 && y < 80 ? 255 : 0)))
    const out = await preparePhoto(png, d)
    expect(out.providedCutout?.type).toBe('image/png')
    expect(out.photo.type).toBe('image/jpeg')
    expect(d.encoded).toEqual([{ w: 68, h: 68 }]) // contenido de 60 px + 4 px de margen por lado
    expect(d.flatten).toHaveBeenCalledOnce()
  })

  it('opaca: sin recorte provisto, la foto sigue el camino de siempre', async () => {
    const d = deps(rgbaWith(40, 40, () => 255))
    const out = await preparePhoto(png, d)
    expect(out.providedCutout).toBeNull()
    expect(d.encodePng).not.toHaveBeenCalled()
    expect(d.flatten).toHaveBeenCalledOnce()
  })

  it('un JPEG ni se decodifica', async () => {
    const d = deps(rgbaWith(40, 40, () => 0))
    expect(await detectProvidedCutout(new File(['x'], 'a.jpg', { type: 'image/jpeg' }), d)).toBeNull()
    expect(d.decode).not.toHaveBeenCalled()
  })

  it('si no se puede decodificar o codificar no lanza', async () => {
    expect(await detectProvidedCutout(png, deps(null))).toBeNull()
    const d = deps(rgbaWith(40, 40, (x) => (x < 20 ? 255 : 0)))
    d.encodePng = vi.fn(async () => {
      throw new Error('sin canvas')
    })
    expect(await detectProvidedCutout(png, d)).toBeNull()
  })
})

describe('finishCutoutAfterSave', () => {
  async function setup() {
    const repo = fakeRepo([])
    repo.getPhoto = async () => new Blob(['photo'], { type: 'image/jpeg' })
    const garment = await repo.create({ category: 'top', formality: 3, warmth: 2, photo_path: 'photo:1' })
    return { repo, garment, remover: new MockBackgroundRemover({ downloaded: true }) }
  }

  it('con recorte provisto lo guarda como mask, avisa y no usa el modelo', async () => {
    const { repo, garment, remover } = await setup()
    const seen: string[] = []
    const off = subscribeCutoutChanged((id) => seen.push(id))
    await finishCutoutAfterSave(repo, remover, garment, { providedCutout: new Blob(['c'], { type: 'image/png' }) })
    off()
    expect(repo.garments[0].cutout_kind).toBe('mask')
    expect(seen).toEqual([garment.id])
    await new Promise((r) => setTimeout(r, 20))
    expect(remover.removeCalls).toHaveLength(0)
  })

  it('sin recorte provisto usa la cola de siempre (el modelo)', async () => {
    const { repo, garment, remover } = await setup()
    await finishCutoutAfterSave(repo, remover, garment, {})
    await vi.waitFor(() => expect(remover.removeCalls).toHaveLength(1))
    expect(repo.garments[0].cutout_kind).toBe('mask')
  })

  it('si guardar el provisto falla, cae al modelo', async () => {
    const { repo, garment, remover } = await setup()
    const original = repo.setCutout
    let first = true
    repo.setCutout = async (...args) => {
      if (first) {
        first = false
        throw new Error('disco lleno')
      }
      return original(...args)
    }
    await finishCutoutAfterSave(repo, remover, garment, { providedCutout: new Blob(['c']) })
    await vi.waitFor(() => expect(remover.removeCalls).toHaveLength(1))
  })
})
