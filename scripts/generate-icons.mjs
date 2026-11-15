// Genera los íconos PNG de la PWA (percha blanca sobre fondo #1f2937). Uso: npm run icons
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

/**
 * Percha dibujada en un lienzo de 512x512. `scale` encoge el glifo hacia el centro
 * (el ícono maskable necesita margen de seguridad: el recorte puede comerse ~20% por lado).
 */
const svg = (size, scale) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1f2937"/>
  <g transform="translate(256 262) scale(${scale}) translate(-256 -262)"
     fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 214v-22c0-14 10-22 22-26 22-7 36-24 36-46 0-30-25-52-58-52s-58 22-58 52"/>
    <path d="M256 214 96 318c-26 17-14 58 18 58h284c32 0 44-41 18-58z"/>
  </g>
</svg>`

await mkdir('public/icons', { recursive: true })
for (const [file, size, scale] of [
  ['icon-192.png', 192, 1],
  ['icon-512.png', 512, 1],
  ['icon-maskable-512.png', 512, 0.62],
  ['apple-touch-icon.png', 180, 0.9],
]) {
  await sharp(Buffer.from(svg(size, scale))).png().toFile(`public/icons/${file}`)
  console.log('ok', file)
}
