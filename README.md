# Armario

App web personal (PWA) para fotografiar tu ropa, etiquetarla con IA y recibir cada día 3 outfits según ocasión, clima y uso. Se instala en la pantalla de inicio del iPhone y guarda todo en el dispositivo. El plan completo está en [`PLAN.md`](./PLAN.md).

Estado: Fase 0 (esqueleto con 6 pestañas vacías: Hoy, Armario, Agregar, Comprar, Uso, Ajustes).

## Ejecutar en local

Requiere Node 22+.

```bash
npm ci
npm run dev        # servidor de desarrollo
npm run lint       # ESLint
npm run typecheck  # tsc -b
npm test           # Vitest
npm run build      # build de producción en dist/
npm run preview    # sirve dist/
```

## Base path (`VITE_BASE`)

`vite.config.ts` usa `base: process.env.VITE_BASE ?? '/'`. En local no hace falta definirla. GitHub Pages publica el sitio en `/<nombre-del-repo>/`, así que el CI compila con `VITE_BASE=/<nombre-del-repo>/` (por ejemplo `/armario/`). Para probarlo a mano:

```bash
VITE_BASE=/armario/ npm run build
```

El manifest usa `start_url` y `scope` relativos, por lo que siguen al base path. La app usa `HashRouter` porque GitHub Pages no tiene fallback para SPA.

## Publicar en GitHub Pages

1. Sube el repositorio a GitHub (rama `main`).
2. En el repositorio: Settings → Pages → Source: **GitHub Actions**.
3. Cada push a `main` ejecuta `.github/workflows/deploy.yml`, que compila con el base path correcto y publica. La URL queda en `https://<usuario>.github.io/<repo>/`.

`.github/workflows/ci.yml` corre lint, typecheck, pruebas y build en cada push y pull request.

## Instalar en el iPhone

1. Abre la URL publicada en **Safari**.
2. Toca Compartir → **Agregar a pantalla de inicio**.
3. Abre siempre la app desde el ícono de la pantalla de inicio (no desde Safari): así iOS conserva los datos locales.
4. Haz un **respaldo semanal**: Ajustes → Exportar respaldo y guárdalo en Archivos o iCloud Drive (la app te lo recuerda cada 7 días). Para restaurar en una instalación limpia: Ajustes → Restaurar respaldo. El respaldo no incluye tu API key.

## Íconos

Los PNG de `public/icons/` (percha blanca sobre #1f2937, incluido el maskable) se generan con `npm run icons` (`scripts/generate-icons.mjs`, usa `sharp`).
