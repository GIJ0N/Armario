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

## Respaldo

`src/db/backup.ts`: `createBackup` arma un zip (`armario.sqlite`, `photos/<key>.jpg`, `manifest.json` con app/format/schemaVersion) y `importBackup` lo valida (app, formato, `schemaVersion` <= migraciones) y, antes de reemplazar, guarda la base actual con `saveBackupSnapshot('pre-restore-…')`; luego reemplaza base y fotos en una sola transacción y la UI recarga. Nunca incluye `localStorage` (ajustes / API key). El estado de avisos (último respaldo, aplazar, Safari) vive en `src/lib/backupState.ts`; los avisos del shell en `src/components/ShellBanners.tsx`. El service worker precachea todo (wasm incluido) para abrir sin conexión.

## Estado

Fase actual: 6 completada (incluye 5); siguiente: 7

## Gusto

Cada outfit se califica con 👍/👎 y motivos (`feedback`, una por outfit). El gusto actúa de dos formas: (1) determinista, sin IA: `src/engine/taste.ts` calcula `TastePreferences` (sesgo de formalidad, pares con «no me gusta» en ≥ 2 outfits, prendas con «me gusta») que endurecen el rango de formalidad, se rechazan en validación y puntúan en el compositor; (2) texto: cada 10 calificaciones nuevas `src/taste/` regenera el perfil con la IA (`src/ai/prompts/tasteProfile.ts`, solo atributos, nunca fotos) o con reglas si no hay IA o falla. «Reiniciar gusto» borra el perfil y hace que las calificaciones anteriores dejen de influir, pero las conserva.

## Compras

- `src/purchase/`: evaluador de compras, solo reglas y determinista. `duplicates` (≥2 activas con misma categoría, subcategoría, color principal y formalidad), `simulate` (outfits válidos que incluyen la candidata, por ocasión y en clima templado/calor/frío; sin prioridad de rotación ni repetidos), `verdict` (umbrales `buyMinOutfits` y `buyMinOccasions` en Ajustes/localStorage), `gaps` y `complements` (el motor simula cada complemento y calcula «desbloquea N»), `wardrobeGaps` («Qué le falta», bajo demanda en Uso).
- La IA (`src/ai/prompts/purchaseGaps.ts`) solo redacta la explicación y propone complementos por atributos; sus números se ignoran, se recalculan con el motor y se eliminan enlaces y precios. Sin IA o con error se usa la versión por reglas.
- Candidatas = `garments` con `status = candidate` (no entran al motor de Hoy). `repo.purchases` guarda la evaluación (migración 0004: veredicto `with_complements` y columna `details` JSON). «Lo compré» → `active`; «Descartar» borra prenda y foto tras el diálogo de confirmación.
