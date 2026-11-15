// Genera los íconos PNG placeholder de la PWA. Uso: npm run icons
import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1f2937"/>
  <g fill="none" stroke="#f9fafb" stroke-width="22" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 150a28 28 0 1 1 28 28c-16 0-28 10-28 24v14"/>
    <path d="M256 216 120 300a22 22 0 0 0 12 40h248a22 22 0 0 0 12-40z"/>
  </g>
</svg>`

await mkdir('public/icons', { recursive: true })
for (const [file, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(Buffer.from(svg(size))).png().toFile(`public/icons/${file}`)
  console.log('ok', file)
}
