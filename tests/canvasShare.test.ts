import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAdjustments } from '../src/canvas/adjust'
import { layoutOutfit } from '../src/canvas/layout'
import { mannequinSvgMarkup } from '../src/canvas/mannequin'
import {
  containRect,
  drawOutfit,
  renderOutfitPng,
  SHARE_PADDING,
  SHARE_SCALE,
  shareImageSize,
  type DrawSurface,
  type ShareItem,
  type SharePalette,
} from '../src/canvas/share'
import { shareImageFile } from '../src/canvas/webShare'

const palette: SharePalette = {
  background: 'rgb(233, 233, 230)',
  mannequinBody: 'rgb(200, 200, 200)',
  mannequinGround: 'rgba(0, 0, 0, 0.1)',
  tileFrame: 'rgb(255, 255, 255)',
  shadow: 'rgba(0, 0, 0, 0.3)',
  accent: 'rgb(47, 63, 208)',
}

/** Superficie que registra las llamadas. */
function recorder() {
  const calls: { op: string; args: unknown[]; fill?: string }[] = []
  const surface = {
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    fillRect: (...args: number[]) => calls.push({ op: 'fillRect', args, fill: surface.fillStyle }),
    drawImage: (...args: unknown[]) => calls.push({ op: 'drawImage', args }),
    beginPath: () => calls.push({ op: 'beginPath', args: [] }),
    roundRect: (...args: number[]) => calls.push({ op: 'roundRect', args }),
    arc: (...args: number[]) => calls.push({ op: 'arc', args }),
    fill: () => calls.push({ op: 'fill', args: [], fill: surface.fillStyle }),
    clip: () => calls.push({ op: 'clip', args: [] }),
    save: () => calls.push({ op: 'save', args: [] }),
    restore: () => calls.push({ op: 'restore', args: [] }),
  }
  return { surface: surface as DrawSurface, calls }
}

const autos = layoutOutfit([
  { id: 'top', category: 'top', subcategory: 'Playera' },
  { id: 'bot', category: 'bottom', subcategory: 'Jeans' },
])
const mannequin = { width: 320, height: 600 }

describe('geometría de la imagen para compartir', () => {
  it('tamaño: lienzo + margen a escala 3', () => {
    expect(shareImageSize()).toEqual({ width: (320 + 32) * 3, height: (600 + 32) * 3 })
  })

  it('fondo = superficie de foto del tema, luego el maniquí y las prendas por z ascendente, en sus cajas', () => {
    const { surface, calls } = recorder()
    const adjusted = applyAdjustments(autos, { top: { scale: 1.5, dx: 0, dy: 0 } }, { bot: { scale: 1, dx: 0, dy: 0, z: 5 } })
    const items: ShareItem[] = adjusted.map((b) => ({ box: b, framed: false, src: `u:${b.id}` }))
    const images = new Map([
      ['top', { width: 100, height: 100 }],
      ['bot', { width: 50, height: 100 }],
    ])
    drawOutfit(surface, { items, images, mannequin, palette })
    const { width, height } = shareImageSize()
    expect(calls[0]).toMatchObject({ op: 'fillRect', args: [0, 0, width, height], fill: palette.background })
    const draws = calls.filter((c) => c.op === 'drawImage')
    expect(draws[0].args[0]).toBe(mannequin)
    // bot tiene z más alto (auto 1 + 5): se dibuja al final; top (z 2) antes.
    expect(draws[1].args[0]).toBe(images.get('top'))
    expect(draws[2].args[0]).toBe(images.get('bot'))
    const k = SHARE_SCALE
    const top = adjusted.find((b) => b.id === 'top')!
    const [, x, y, w, h] = draws[1].args as number[]
    // La imagen 1:1 queda contenida y centrada en la caja del ajuste (escalada ×1.5).
    expect(w).toBeCloseTo(Math.min(top.w, top.h) * k, 3)
    expect(h).toBeCloseTo(w, 3)
    expect(x + w / 2).toBeCloseTo((SHARE_PADDING + top.x + top.w / 2) * k, 3)
    expect(y + h / 2).toBeCloseTo((SHARE_PADDING + top.y + top.h / 2) * k, 3)
  })

  it('un mosaico enmarcado dibuja marco redondeado, recorte y alfiler; sin foto solo el marco', () => {
    const { surface, calls } = recorder()
    const items: ShareItem[] = [
      { box: autos[0], framed: true, src: 'u:top' },
      { box: autos[1], framed: true, src: null },
    ]
    drawOutfit(surface, { items, images: new Map([['top', { width: 200, height: 100 }]]), mannequin, palette })
    expect(calls.filter((c) => c.op === 'roundRect')).toHaveLength(3) // marco+recorte de top, marco de bot
    expect(calls.filter((c) => c.op === 'drawImage')).toHaveLength(2) // maniquí + foto de top
    expect(calls.filter((c) => c.op === 'arc')).toHaveLength(2)
    expect(calls.filter((c) => c.op === 'fill' && c.fill === palette.tileFrame)).toHaveLength(2)
  })

  it('containRect no deforma', () => {
    expect(containRect({ width: 200, height: 100 }, { x: 0, y: 0, w: 100, h: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })

  it('el maniquí es un SVG autónomo con los colores resueltos', () => {
    const svg = mannequinSvgMarkup({ body: 'rgb(1, 2, 3)', ground: 'rgb(4, 5, 6)' })
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('fill="rgb(1, 2, 3)"')
    expect(svg).not.toContain('var(')
  })

  it('renderOutfitPng usa la superficie y el cargador inyectados', async () => {
    const { surface, calls } = recorder()
    const blob = new Blob(['png'], { type: 'image/png' })
    const loaded: string[] = []
    const out = await renderOutfitPng(
      { items: [{ box: autos[0], framed: false, src: 'blob:top' }], palette },
      {
        createSurface: (w, h) => {
          expect([w, h]).toEqual([shareImageSize().width, shareImageSize().height])
          return { ctx: surface, toBlob: async () => blob }
        },
        loadImage: async (src) => {
          loaded.push(src)
          return { width: 10, height: 10 }
        },
      },
    )
    expect(out).toBe(blob)
    expect(loaded[0]).toMatch(/^data:image\/svg\+xml/)
    expect(loaded).toContain('blob:top')
    expect(calls.some((c) => c.op === 'drawImage')).toBe(true)
  })

  it('si no carga el maniquí, lanza', async () => {
    await expect(
      renderOutfitPng({ items: [], palette }, { createSurface: () => ({ ctx: recorder().surface, toBlob: async () => new Blob() }), loadImage: async () => null }),
    ).rejects.toThrow()
  })
})

describe('shareImageFile (Web Share con respaldo de descarga)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  const blob = new Blob(['x'], { type: 'image/png' })

  it('canShare true → navigator.share con un archivo PNG', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, canShare: vi.fn(() => true) })
    await expect(shareImageFile(blob, 'outfit.png', 'Mi outfit')).resolves.toBe('shared')
    const arg = share.mock.calls[0][0] as { files: File[] }
    expect(arg.files).toHaveLength(1)
    expect(arg.files[0].type).toBe('image/png')
    expect(arg.files[0].name).toBe('outfit.png')
  })

  it('canShare false → descarga', async () => {
    const share = vi.fn()
    vi.stubGlobal('navigator', { share, canShare: vi.fn(() => false) })
    URL.createObjectURL = vi.fn(() => 'blob:dl')
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await expect(shareImageFile(blob, 'outfit.png')).resolves.toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('cerrar la hoja de compartir no es un error; otros fallos sí lanzan', async () => {
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('x', 'AbortError')), canShare: () => true })
    await expect(shareImageFile(blob, 'o.png')).resolves.toBe('cancelled')
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new Error('boom')), canShare: () => true })
    await expect(shareImageFile(blob, 'o.png')).rejects.toThrow('boom')
  })
})
