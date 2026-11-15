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

SQLite WASM (`@sqlite.org/sqlite-wasm`) corre en memoria. Tras cada transacción de escritura se exporta la base completa (`sqlite3_js_db_export`) a IndexedDB y al abrir se restaura con `sqlite3_deserialize`; no se usa OPFS (GitHub Pages no permite COOP/COEP y OPFS es irregular en iOS). Las fotos son Blobs en otro object store de IndexedDB; `garments.photo_path` guarda la clave (`photo:<uuid>`). La UI solo usa `GarmentRepository` (`src/db/repository.ts`) y el adaptador `Storage` (`src/db/storage.ts`), de modo que el backend se puede reemplazar. Migraciones en `src/db/migrations/`, con `PRAGMA user_version`. La migración 0005 agrega `garments.cutout_path` y `cutout_kind` (ver «Recorte de fondo»).

## IA

- `AiProvider` (`src/ai/provider.ts`): `tagGarment(image)` y `generateJson<T>({ system, user, images, schema, jsonSchema })`, reutilizable por fases futuras. Errores tipados en `src/ai/errors.ts`.
- `GeminiProvider` usa `fetch` directo; respuesta validada con zod y un reintento con el error en el prompt. Los prompts viven en `src/ai/prompts/`.
- Las pruebas usan `MockAiProvider` (`src/ai/mock.ts`) inyectado con `AiProviderContextProvider`; ninguna prueba toca la red.
- Los ajustes (API key, modelo, ciudad) están en `localStorage` (`src/settings/`), nunca en SQLite, para que los respaldos no incluyan la key.

## Respaldo

`src/db/backup.ts`: `createBackup` arma un zip (`armario.sqlite`, `photos/<key>.jpg`, `manifest.json` con app/format/schemaVersion) y `importBackup` lo valida (app, formato, `schemaVersion` <= migraciones) y, antes de reemplazar, guarda la base actual con `saveBackupSnapshot('pre-restore-…')`; luego reemplaza base y fotos en una sola transacción y la UI recarga. Nunca incluye `localStorage` (ajustes / API key). El estado de avisos (último respaldo, aplazar, Safari) vive en `src/lib/backupState.ts`; los avisos del shell en `src/components/ShellBanners.tsx`. El service worker precachea todo (wasm incluido) para abrir sin conexión.

## Estado

Fase actual: 9 completada; siguiente: 10–12 (plan Armario v2)

## Gusto

Cada outfit se califica con 👍/👎 y motivos (`feedback`, una por outfit). El gusto actúa de dos formas: (1) determinista, sin IA: `src/engine/taste.ts` calcula `TastePreferences` (sesgo de formalidad, pares con «no me gusta» en ≥ 2 outfits, prendas con «me gusta») que endurecen el rango de formalidad, se rechazan en validación y puntúan en el compositor; (2) texto: cada 10 calificaciones nuevas `src/taste/` regenera el perfil con la IA (`src/ai/prompts/tasteProfile.ts`, solo atributos, nunca fotos) o con reglas si no hay IA o falla. «Reiniciar gusto» borra el perfil y hace que las calificaciones anteriores dejen de influir, pero las conserva.

## Compras

- `src/purchase/`: evaluador de compras, solo reglas y determinista. `duplicates` (≥2 activas con misma categoría, subcategoría, color principal y formalidad), `simulate` (outfits válidos que incluyen la candidata, por ocasión y en clima templado/calor/frío; sin prioridad de rotación ni repetidos), `verdict` (umbrales `buyMinOutfits` y `buyMinOccasions` en Ajustes/localStorage), `gaps` y `complements` (el motor simula cada complemento y calcula «desbloquea N»), `wardrobeGaps` («Qué le falta», bajo demanda en Uso).
- La IA (`src/ai/prompts/purchaseGaps.ts`) solo redacta la explicación y propone complementos por atributos; sus números se ignoran, se recalculan con el motor y se eliminan enlaces y precios. Sin IA o con error se usa la versión por reglas.
- Candidatas = `garments` con `status = candidate` (no entran al motor de Hoy). `repo.purchases` guarda la evaluación (migración 0004: veredicto `with_complements` y columna `details` JSON). «Lo compré» → `active`; «Descartar» borra prenda y foto tras el diálogo de confirmación.

## Interfaz

- Tokens en `src/index.css` (colores, superficies, radios, espacios, sombras, fuentes): ningún hexadecimal fuera de los bloques de tokens. Dos temas, «Neutro» y «Cálido», elegidos en Ajustes > Apariencia (`theme` en `localStorage`, validado en `loadSettings`) y aplicados como `data-theme` en `<html>` (`useApplyTheme`; `index.html` lo fija antes de pintar). El modo oscuro es automático (`prefers-color-scheme`) en ambos.
- Tipografía: Fraunces (variable, solo latin, `@fontsource-variable/fraunces`, empaquetada y precacheada por el service worker) para títulos y cifras; fuente del sistema para el cuerpo.
- Iconos: `lucide-react` importados uno por uno; nunca emojis como iconos.
- Navegación: 5 pestañas (Hoy, Armario, «Agregar» central, Comprar, Yo). `/yo` reúne el resumen de uso y enlaces a `/uso` y `/ajustes`; la pestaña Yo está activa en las tres rutas.
- `OutfitVisual` aísla el área de fotos de `OutfitCard` (la fase 11 la sustituye por el maniquí). Las fotos de prendas siempre con `object-fit: contain` sobre `--surface-photo`.
- Diálogos = `BottomSheet` (hoja inferior: Escape, fondo, foco atrapado y devuelto, `aria-modal`); `ConfirmDialog` la usa. Avisos breves con `ToastProvider`/`useToast` (sin proveedor no hacen nada). Carga con `Skeleton*`.
- Agregar admite varias fotos: cola secuencial (una foto reducida y etiquetada a la vez, «Foto 2 de 5», se puede omitir).

## Recorte de fondo

Cada prenda puede tener un recorte sin fondo (`src/cutout/`) para el maniquí de fases futuras y una cuadrícula limpia; la foto original siempre se conserva. Las fotos guardadas miden hasta 1600 px (`MAX_EDGE`); a Gemini se envía una copia a ≤1024 px (`downscaleForAi`).

- **Datos**: `garments.cutout_path` (clave `cutout:<uuid>` en el mismo almacén de fotos de IndexedDB) y `cutout_kind` (`'mask'` = PNG con alfa recortado al contenido; `'bbox'` = JPEG rectangular sin transparencia). `repo.setCutout/clearCutout`; borrar la prenda, cambiar o quitar su foto, o reemplazar el recorte borra el blob anterior. El respaldo incluye los recortes (`photos/<clave>.png|.jpg`, `cutoutCount` en el manifiesto) y los respaldos de la versión 4 siguen importándose.
- **Modelo**: RMBG-1.4 cuantizado int8 (salida de objeto saliente, no solo personas; entrada 1024×1024, normalización `x/255 - 0.5`). URL `https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx`, ≈ 44 MB. Licencia de los pesos: bria-rmbg-1.4 (no comercial; uso personal permitido). Los pesos no están en el repositorio: el teléfono los baja una vez, solo con el botón «Descargar modelo» de Ajustes (nada los descarga solo), y quedan en Cache Storage (`armario-cutout-v1`), por lo que funcionan sin conexión. Configuración en `src/cutout/modelConfig.ts`.
- **Runtime**: `onnxruntime-web` (MIT) en un Web Worker (`src/cutout/worker.ts`); el worker solo infiere, el canvas se usa en el hilo principal. Un solo hilo de WASM (sin `SharedArrayBuffer`: GitHub Pages no envía COOP/COEP). Motores: WebGPU si `navigator.gpu` existe (compilación `onnxruntime-web/webgpu`) y, si falla o devuelve una máscara vacía, WASM (`onnxruntime-web/wasm`); en Ajustes se puede forzar «Solo WASM». No se usa `@imgly/background-removal` (AGPL).
- **WASM en caché**: los `.wasm` de ORT (15 MB y 29 MB) salen empaquetados con la app (mismo origen, `?url`), pero se excluyen del precache (`globIgnores`) y el service worker los guarda en tiempo de ejecución (CacheFirst, `armario-ort-wasm`); «Descargar modelo» también los pide para dejarlos listos sin conexión. El precache solo crece unos 0.2 MB (código del worker).
- **Orden de respaldo** (`generateCutout` en `pipeline.ts`): (1) máscara con el modelo, solo si ya está descargado y dentro de 90 s; (2) plan B: recorte rectangular con el `bbox` opcional {x,y,w,h} normalizado 0–1 que propone Gemini (`TAG_GARMENT_JSON_SCHEMA`; validado con zod, si es inválido se ignora sin error); (3) sin recorte: la interfaz usa la original. Todo trabajo de recorte pasa por `runExclusive` (uno a la vez).
- **Pruebas**: se inyecta `MockBackgroundRemover` con `BackgroundRemoverContextProvider` (como `AiProviderContext`); ninguna prueba ni e2e carga el modelo real.
- **UI**: `GarmentPhoto` acepta `cutoutPath` y `variant`; `CutoutControls` (detalle: «Sin fondo / Original», «Rehacer recorte») y `CutoutSettings` (Ajustes: modelo, motor, «Procesar prendas sin recorte», «Probar recorte» con milisegundos y motor usado).
