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
- `npm run e2e`: Playwright con el Chrome del sistema (`/usr/bin/google-chrome`); construye y sirve con `VITE_BASE=/Armario/`.

Antes de cerrar una fase, lint, typecheck, test y build deben pasar sin errores.

## Almacenamiento

SQLite WASM (`@sqlite.org/sqlite-wasm`) corre en memoria. Tras cada transacción de escritura se exporta la base completa (`sqlite3_js_db_export`) a IndexedDB y al abrir se restaura con `sqlite3_deserialize`; no se usa OPFS (GitHub Pages no permite COOP/COEP y OPFS es irregular en iOS). Las fotos son Blobs en otro object store de IndexedDB; `garments.photo_path` guarda la clave (`photo:<uuid>`). La UI solo usa `GarmentRepository` (`src/db/repository.ts`) y el adaptador `Storage` (`src/db/storage.ts`), de modo que el backend se puede reemplazar. Migraciones en `src/db/migrations/`, con `PRAGMA user_version`.

## IA

- `AiProvider` (`src/ai/provider.ts`): `tagGarment(image)` y `generateJson<T>({ system, user, images, schema, jsonSchema })`, reutilizable por fases futuras. Errores tipados en `src/ai/errors.ts`.
- `GeminiProvider` usa `fetch` directo; respuesta validada con zod y un reintento con el error en el prompt. Los prompts viven en `src/ai/prompts/`.
- Las pruebas usan `MockAiProvider` (`src/ai/mock.ts`) inyectado con `AiProviderContextProvider`; ninguna prueba toca la red.
- Los ajustes (API key, modelo, ciudad) están en `localStorage` (`src/settings/`), nunca en SQLite, para que los respaldos no incluyan la key.

## Estado

Fase actual: 1 completada; siguiente: 2
