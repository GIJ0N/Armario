import { CANVAS_H, CANVAS_W, type PlacedBox, type Rect } from './layout'
import { mannequinSvgMarkup } from './mannequin'

/**
 * Imagen para compartir: dibuja el maniquí y las prendas (ya con sus ajustes) en una superficie tipo canvas 2D.
 * La superficie y la carga de imágenes son inyectables para probar la geometría sin DOM. Nunca usa la red.
 */

/** Subconjunto de CanvasRenderingContext2D que se usa. */
export interface DrawSurface {
  fillStyle: string
  shadowColor: string
  shadowBlur: number
  shadowOffsetY: number
  fillRect(x: number, y: number, w: number, h: number): void
  drawImage(img: DrawableImage, x: number, y: number, w: number, h: number): void
  beginPath(): void
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  arc(x: number, y: number, r: number, a0: number, a1: number): void
  fill(): void
  clip(): void
  save(): void
  restore(): void
}

export interface DrawableImage {
  width: number
  height: number
}

export interface ShareItem {
  /** Caja final (colocación automática + ajustes). */
  box: PlacedBox
  /** true = mosaico enmarcado (foto original o recorte rectangular). */
  framed: boolean
  /** URL de la imagen (object URL); null si la prenda no tiene foto. */
  src: string | null
}

export interface SharePalette {
  background: string
  mannequinBody: string
  mannequinGround: string
  tileFrame: string
  shadow: string
  accent: string
}

export const SHARE_SCALE = 3
/** Margen alrededor del lienzo, en unidades del viewBox. */
export const SHARE_PADDING = 16
/** Marco del mosaico y su radio (mismos valores que `.canvas-tile`, en unidades del viewBox aprox.). */
const TILE_BORDER = 4
const TILE_RADIUS = 12

export function shareImageSize(scale = SHARE_SCALE) {
  return { width: Math.round((CANVAS_W + SHARE_PADDING * 2) * scale), height: Math.round((CANVAS_H + SHARE_PADDING * 2) * scale) }
}

/** Ajusta una imagen de tamaño natural dentro de `rect` sin deformarla (centrada). */
export function containRect(img: DrawableImage, rect: Rect): Rect {
  if (!img.width || !img.height) return rect
  const k = Math.min(rect.w / img.width, rect.h / img.height)
  const w = img.width * k
  const h = img.height * k
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h }
}

export interface DrawInput {
  items: ShareItem[]
  /** Imágenes ya cargadas por id de prenda. */
  images: ReadonlyMap<string, DrawableImage>
  mannequin: DrawableImage
  palette: SharePalette
  scale?: number
}

/** Dibuja el outfit completo. Función determinista: solo llama a la superficie. */
export function drawOutfit(ctx: DrawSurface, input: DrawInput): void {
  const k = input.scale ?? SHARE_SCALE
  const { width, height } = shareImageSize(k)
  const ox = SHARE_PADDING * k
  const oy = SHARE_PADDING * k
  const px = (r: Rect): Rect => ({ x: ox + r.x * k, y: oy + r.y * k, w: r.w * k, h: r.h * k })

  ctx.fillStyle = input.palette.background
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(input.mannequin, ox, oy, CANVAS_W * k, CANVAS_H * k)

  // Orden de apilado: z ascendente; a igual z, el orden original (como el DOM).
  const ordered = input.items.map((item, i) => ({ item, i })).sort((a, b) => a.item.box.z - b.item.box.z || a.i - b.i)
  for (const { item } of ordered) {
    const img = item.src ? input.images.get(item.box.id) : undefined
    const box = px(item.box)
    if (item.framed) {
      const r = TILE_RADIUS * k
      const b = TILE_BORDER * k
      ctx.save()
      ctx.shadowColor = input.palette.shadow
      ctx.shadowBlur = 6 * k
      ctx.shadowOffsetY = 2 * k
      ctx.fillStyle = input.palette.tileFrame
      ctx.beginPath()
      ctx.roundRect(box.x, box.y, box.w, box.h, r)
      ctx.fill()
      ctx.restore()
      if (img) {
        const inner = { x: box.x + b, y: box.y + b, w: box.w - 2 * b, h: box.h - 2 * b }
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(inner.x, inner.y, inner.w, inner.h, Math.max(0, r - b))
        ctx.clip()
        const t = containRect(img, inner)
        ctx.drawImage(img, t.x, t.y, t.w, t.h)
        ctx.restore()
      }
      ctx.fillStyle = input.palette.accent
      ctx.beginPath()
      ctx.arc(box.x + box.w / 2, box.y + 3.5 * k, 1.8 * k, 0, Math.PI * 2)
      ctx.fill()
    } else if (img) {
      const t = containRect(img, box)
      ctx.save()
      ctx.shadowColor = input.palette.shadow
      ctx.shadowBlur = 3 * k
      ctx.shadowOffsetY = 2 * k
      ctx.drawImage(img, t.x, t.y, t.w, t.h)
      ctx.restore()
    }
  }
}

export interface Surface {
  ctx: DrawSurface
  toBlob(): Promise<Blob>
}

export interface ShareDeps {
  createSurface(width: number, height: number): Surface
  /** Devuelve null si no se puede cargar (la prenda se dibuja sin imagen). */
  loadImage(src: string): Promise<(DrawableImage & { src?: string }) | null>
}

export interface RenderInput {
  items: ShareItem[]
  palette: SharePalette
  scale?: number
}

export function mannequinDataUrl(palette: Pick<SharePalette, 'mannequinBody' | 'mannequinGround'>): string {
  const svg = mannequinSvgMarkup({ body: palette.mannequinBody, ground: palette.mannequinGround })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Renderiza el outfit a un PNG. Lanza si no se puede (el llamador muestra el aviso). */
export async function renderOutfitPng(input: RenderInput, deps: ShareDeps = defaultDeps()): Promise<Blob> {
  const scale = input.scale ?? SHARE_SCALE
  const mannequin = await deps.loadImage(mannequinDataUrl(input.palette))
  if (!mannequin) throw new Error('No se pudo dibujar el maniquí')
  const images = new Map<string, DrawableImage>()
  await Promise.all(
    input.items.map(async (it) => {
      if (!it.src) return
      const img = await deps.loadImage(it.src)
      if (img) images.set(it.box.id, img)
    }),
  )
  const { width, height } = shareImageSize(scale)
  const surface = deps.createSurface(width, height)
  drawOutfit(surface.ctx, { items: input.items, images, mannequin, palette: input.palette, scale })
  return surface.toBlob()
}

/** Resuelve un token de color (`--surface-photo`, `--mannequin-fill`…) a un color concreto con los estilos calculados. */
export function resolveCssColor(token: string, doc: Document = document): string {
  const probe = doc.createElement('span')
  probe.style.color = `var(${token})`
  probe.style.display = 'none'
  doc.body.appendChild(probe)
  const value = doc.defaultView?.getComputedStyle(probe).color
  probe.remove()
  return value || '#e9e9e6'
}

/** Paleta del tema actual (claro/oscuro, Neutro/Cálido) tomada de los estilos calculados. */
export function currentPalette(doc: Document = document): SharePalette {
  return {
    background: resolveCssColor('--surface-photo', doc),
    mannequinBody: resolveCssColor('--mannequin-fill', doc),
    mannequinGround: resolveCssColor('--mannequin-ground', doc),
    tileFrame: resolveCssColor('--tile-frame', doc),
    shadow: resolveCssColor('--cutout-shadow', doc),
    accent: resolveCssColor('--accent', doc),
  }
}

function defaultDeps(): ShareDeps {
  return {
    createSurface(width, height) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas no disponible')
      return {
        ctx: ctx as unknown as DrawSurface,
        toBlob: () =>
          new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen'))), 'image/png'),
          ),
      }
    },
    loadImage(src) {
      return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img.naturalWidth ? img : null)
        img.onerror = () => resolve(null)
        img.src = src
      })
    },
  }
}
