import { CANVAS_H, CANVAS_W } from './layout'

/**
 * Trazos del maniquí (unidades del viewBox). Se comparten entre el componente `Mannequin` y la imagen para compartir
 * (`share.ts`). Se dibuja el lado izquierdo de brazo, pierna y pie y se refleja.
 */
export const MANNEQUIN_HEAD = 'M160 14 C176 14 184 30 183 46 C182 62 174 74 160 75 C146 74 138 62 137 46 C136 30 144 14 160 14 Z'
export const MANNEQUIN_TORSO = 'M150 62 C148 82 146 94 138 100 C126 104 110 106 100 114 C96 118 94 126 95 138 C100 152 104 158 106 168 C107 200 113 232 120 256 C121 272 117 284 114 298 L206 298 C203 284 199 272 200 256 C207 232 213 200 214 168 C216 158 220 152 225 138 C226 126 224 118 220 114 C210 106 194 104 182 100 C174 94 172 82 170 62 Z'
export const MANNEQUIN_HALF = [
  // brazo: deltoides redondo, codo suave, antebrazo que se afina hacia la muñeca y mano con pulgar
  'M99 116 C88 118 82 130 80 146 C77 170 76 192 72 214 C69 232 66 252 64 276 C63 288 62 296 61 304 C57 318 55 330 57 342 C58 352 67 358 73 350 C76 345 77 339 78 334 C80 330 84 329 85 320 C86 312 85 308 85 304 C87 292 89 278 92 262 C96 244 100 228 103 210 C106 192 108 172 109 156 C107 140 106 124 99 116 Z',
  // pierna: muslo que se afina a la rodilla, pantorrilla, tobillo fino
  'M160 270 L119 270 C113 300 109 346 113 380 C115 402 118 414 119 428 C120 446 116 462 117 482 C118 502 124 520 127 538 L150 538 C151 520 152 502 153 484 C154 462 153 444 154 428 C156 400 158 360 160 300 Z',
  // pie abierto hacia afuera
  'M126 534 L151 534 C152 548 151 560 148 572 C144 586 126 596 108 590 C99 587 99 580 107 574 C117 568 122 556 126 534 Z',
] as const

/** SVG autónomo del maniquí con los colores ya resueltos (no usa variables CSS: se dibuja como imagen en un canvas). */
export function mannequinSvgMarkup(colors: { body: string; ground: string }): string {
  const half = MANNEQUIN_HALF.map((d) => `<path d="${d}"/>`).join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" width="${CANVAS_W}" height="${CANVAS_H}">` +
    `<ellipse cx="160" cy="594" rx="86" ry="5" fill="${colors.ground}"/>` +
    `<g fill="${colors.body}"><path d="${MANNEQUIN_HEAD}"/><path d="${MANNEQUIN_TORSO}"/>${half}` +
    `<g transform="translate(${CANVAS_W} 0) scale(-1 1)">${half}</g></g></svg>`
  )
}
