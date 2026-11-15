# CLAUDE.md

Armario es una PWA personal (Vite + React + TypeScript, SQLite WASM en el iPhone, Gemini para visión y estilista, Open-Meteo para clima) que etiqueta la ropa desde fotos y propone 3 outfits diarios para usar más prendas del armario. El plan completo, el modelo de datos, el motor de outfits y las fases están en `PLAN.md`; léelo antes de trabajar.

## Reglas para el agente


- Una fase por pull request; no empezar la siguiente sin cumplir la aceptación.
- Ninguna API key, foto personal ni base de datos en el repositorio.
- Todo lo que llama a la IA pasa por `AiProvider`; las pruebas usan el proveedor simulado.
- Toda respuesta de la IA se valida contra un esquema antes de tocar la base de datos.
- Los prompts viven en `src/ai/prompts/` como archivos propios.
- Las migraciones SQL solo avanzan y ninguna borra datos sin generar antes un respaldo.
- Textos de interfaz en español; código y nombres en inglés.

## Comandos

- `npm run lint`: ESLint (flat config).
- `npm run typecheck`: `tsc -b`.
- `npm test`: Vitest (`vitest run`).
- `npm run build`: typecheck + build de producción. Para GitHub Pages: `VITE_BASE=/armario/ npm run build`.
- `npm run dev`: servidor de desarrollo.

Antes de cerrar una fase, lint, typecheck, test y build deben pasar sin errores.

## Estado

Fase actual: 0 completada; siguiente: 1
