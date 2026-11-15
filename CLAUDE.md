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

SQLite WASM (`@sqlite.org/sqlite-wasm`) corre en memoria. Tras cada transacción de escritura se exporta la base completa (`sqlite3_js_db_export`) a IndexedDB y al abrir se restaura con `sqlite3_deserialize`; no se usa OPFS (GitHub Pages no permite COOP/COEP y OPFS es irregular en iOS). Las fotos son Blobs en otro object store de IndexedDB; `garments.photo_path` guarda la clave (`photo:<uuid>`). La UI solo usa `GarmentRepository` (`src/db/repository.ts`) y el adaptador `Storage` (`src/db/storage.ts`), de modo que el backend se puede reemplazar. Migraciones en `src/db/migrations/`, con `PRAGMA user_version`. La migración 0005 agrega `garments.cutout_path` y `cutout_kind` (ver «Recorte de fondo»); la 0006, `garments.favorite`, `outfits.saved_at`/`name` y la tabla `outfit_swaps` (ver «Edición y favoritos»).

## IA

- `AiProvider` (`src/ai/provider.ts`): `tagGarment(image)` y `generateJson<T>({ system, user, images, schema, jsonSchema })`, reutilizable por fases futuras. Errores tipados en `src/ai/errors.ts`.
- `GeminiProvider` usa `fetch` directo; respuesta validada con zod y un reintento con el error en el prompt. Los prompts viven en `src/ai/prompts/`.
- Las pruebas usan `MockAiProvider` (`src/ai/mock.ts`) inyectado con `AiProviderContextProvider`; ninguna prueba toca la red.
- Los ajustes (API key, modelo, ciudad) están en `localStorage` (`src/settings/`), nunca en SQLite, para que los respaldos no incluyan la key.

## Respaldo

`src/db/backup.ts`: `createBackup` arma un zip (`armario.sqlite`, `photos/<key>.jpg`, `manifest.json` con app/format/schemaVersion) y `importBackup` lo valida (app, formato, `schemaVersion` <= migraciones) y, antes de reemplazar, guarda la base actual con `saveBackupSnapshot('pre-restore-…')`; luego reemplaza base y fotos en una sola transacción y la UI recarga. Nunca incluye `localStorage` (ajustes / API key). El estado de avisos (último respaldo, aplazar, Safari) vive en `src/lib/backupState.ts`; los avisos del shell en `src/components/ShellBanners.tsx`. El service worker precachea todo (wasm incluido) para abrir sin conexión.

## Estado

Fase actual: 12 completada; v2 terminada salvo la fase 13 opcional (costo por uso, planear semana, viaje)

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
- `OutfitVisual` es el único punto de entrada del área visual de un outfit: dibuja el lienzo con maniquí (ver «Lienzo») o, sin prenda de arriba ni de abajo, la cuadrícula de miniaturas anterior. En Hoy las tres tarjetas van en `OutfitCarousel` (scroll-snap, un outfit por vista, puntos y contador «1/3»). Las fotos de prendas siempre con `object-fit: contain` sobre `--surface-photo`.
- Diálogos = `BottomSheet` (hoja inferior: Escape, fondo, foco atrapado y devuelto, `aria-modal`); `ConfirmDialog` la usa. Avisos breves con `ToastProvider`/`useToast` (sin proveedor no hacen nada). Carga con `Skeleton*`.
- Agregar admite varias fotos: cola secuencial (una foto reducida y etiquetada a la vez, «Foto 2 de 5», se puede omitir).

## Recorte de fondo

Cada prenda puede tener un recorte sin fondo (`src/cutout/`) para el maniquí de fases futuras y una cuadrícula limpia; la foto original siempre se conserva. Las fotos guardadas miden hasta 1600 px (`MAX_EDGE`); a Gemini se envía una copia a ≤1024 px (`downscaleForAi`).

- **Datos**: `garments.cutout_path` (clave `cutout:<uuid>` en el mismo almacén de fotos de IndexedDB) y `cutout_kind` (`'mask'` = PNG con alfa recortado al contenido; `'bbox'` = JPEG rectangular sin transparencia). `repo.setCutout/clearCutout`; borrar la prenda, cambiar o quitar su foto, o reemplazar el recorte borra el blob anterior. El respaldo incluye los recortes (`photos/<clave>.png|.jpg`, `cutoutCount` en el manifiesto) y los respaldos de la versión 4 siguen importándose.
- **Modelo**: RMBG-1.4 cuantizado int8 (salida de objeto saliente, no solo personas; entrada 1024×1024, normalización `x/255 - 0.5`). URL `https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx`, ≈ 44 MB. Licencia de los pesos: bria-rmbg-1.4 (no comercial; uso personal permitido). Los pesos no están en el repositorio: el teléfono los baja una vez, solo con el botón «Descargar modelo» de Ajustes (nada los descarga solo), y quedan en Cache Storage (`armario-cutout-v1`), por lo que funcionan sin conexión. Configuración en `src/cutout/modelConfig.ts`.
- **Runtime**: `onnxruntime-web` (MIT) en un Web Worker (`src/cutout/worker.ts`); el worker solo infiere, el canvas se usa en el hilo principal. Un solo hilo de WASM (sin `SharedArrayBuffer`: GitHub Pages no envía COOP/COEP). Motores: WebGPU si `navigator.gpu` existe (compilación `onnxruntime-web/webgpu`) y, si falla o devuelve una máscara vacía, WASM (`onnxruntime-web/wasm`); en Ajustes se puede forzar «Solo WASM». No se usa `@imgly/background-removal` (AGPL).
- **WASM en caché**: los `.wasm` de ORT (15 MB y 29 MB) salen empaquetados con la app (mismo origen, `?url`), pero se excluyen del precache (`globIgnores`) y el service worker los guarda en tiempo de ejecución (CacheFirst, `armario-ort-wasm`); «Descargar modelo» también los pide para dejarlos listos sin conexión. El precache solo crece unos 0.2 MB (código del worker).
- **Limpieza de la máscara** (`cleanMaskAlpha` en `src/cutout/geometry.ts`, pura y probada con máscaras sintéticas; `cutoutFromMask` la aplica a la resolución de la máscara, 1024², y después reescala el alfa a la foto): (1) `softenAlpha` = smoothstep 0.35–0.65 sobre la salida normalizada; (2) binario; (3) apertura 3×3 ×3 (quita motas y rebabas de hasta ~6 px) y cierre 3×3 (agujeritos); (4) `keepMainComponents`: solo la componente más grande y las de ≥ 5 % de su área (restos de gancho, motas flotantes), con relleno iterativo, sin recursión; (5) `fillSmallHoles`: agujeros interiores < 0.4 % del área de la prenda (los huecos abiertos al borde, como entre las piernas, no se tocan); (6) `featherMask`: borde suavizado ~1 px. Después se recorta al contenido ya limpio con margen, la cobertura (`MIN_MASK_COVERAGE`) se mide con el alfa limpio y `decontaminateEdges` reemplaza el color de los píxeles de borde por el de la prenda cercana (sin halo del fondo). Ajustes › «Rehacer todos los recortes (N)» vuelve a recortar todas las prendas con foto (también las que ya tenían recorte; cancelable, con avance; si una falla conserva el recorte anterior) para aplicar mejoras de limpieza a recortes viejos; «Rehacer recorte» del detalle hace lo mismo con una prenda.
- **Orden de respaldo** (`generateCutout` en `pipeline.ts`): (1) máscara con el modelo, solo si ya está descargado y dentro de 90 s; (2) plan B: recorte rectangular con el `bbox` opcional {x,y,w,h} normalizado 0–1 que propone Gemini (`TAG_GARMENT_JSON_SCHEMA`; validado con zod, si es inválido se ignora sin error); (3) sin recorte: la interfaz usa la original. Todo trabajo de recorte pasa por `runExclusive` (uno a la vez).
- **Pruebas**: se inyecta `MockBackgroundRemover` con `BackgroundRemoverContextProvider` (como `AiProviderContext`); ninguna prueba ni e2e carga el modelo real.
- **UI**: `GarmentPhoto` acepta `cutoutPath` y `variant`; `CutoutControls` (detalle: «Sin fondo / Original», «Rehacer recorte») y `CutoutSettings` (Ajustes: modelo, motor, «Procesar prendas sin recorte», «Probar recorte» con milisegundos y motor usado).

## Lienzo

Cada outfit se ve sobre un maniquí neutro (`OutfitCanvas`, usado por `OutfitVisual`; también en los ejemplos de Comprar con `size="small"`). Determinista, sin IA, sin red y sin tocar la base.

- **Diseño** (`src/canvas/layout.ts`, función pura `layoutOutfit` probada en `tests/canvasLayout.test.ts`): viewBox 320×600, maniquí de frente centrado en `CX`: croquis de moda masculino sin rostro (hombros redondeados que caen desde el cuello, torso que se afina, brazos relajados algo separados con manos, piernas con rodillas y un pequeño hueco, pies hacia afuera; lado izquierdo dibujado y reflejado en `Mannequin`). Cada prenda recibe una caja `{x,y,w,h,z,zone,framed}` en unidades del viewBox; el componente la coloca en porcentajes, así que escala con el contenedor. `fitContain` ajusta la imagen a su zona sin deformarla (arriba/abajo/centro); sin relación de aspecto conocida se usa `DEFAULT_ASPECT` por categoría.
- **Zonas y regla de altura primero**: cada zona (`ZONES`) tiene una altura objetivo y un ancho máximo; `fitContain` busca primero la altura de la zona y solo si el ancho se pasa del máximo reduce todo de forma uniforme (una prenda nunca baja de la altura objetivo por culpa de la zona). top = hombro a cadera (y 98–268, ancho máx. 200); bottom = cintura a tobillo (y 256–536, ancho máx. 190: unos jeans holgados pueden sobresalir del cuerpo; subcategoría con short/bermuda/falda: solo a rodillas); el top queda `TUCK_OVERLAP` (12) por debajo de la cintura del pantalón y encima (metido); outerwear = algo más grande (y 94–294, ancho máx. 220); shoes = pies, un par centrado anclado abajo. Con abrigo y top a la vez, el abrigo queda debajo y el top se superpone en una columna central angosta (`torso-center`, «abrigo abierto») para que siga visible. Accesorios por palabras clave de la subcategoría (`accessoryKind`): gorra/sombrero/gorro → cabeza; lentes/gafas → cara; bufanda/corbata → cuello; reloj/pulsera → muñeca; cinturón → cintura (sobre top y bottom); mochila, bolsa y lo demás → columnas laterales (derecha primero). Sin relación de aspecto conocida se usa `DEFAULT_ASPECT` por categoría (jeans 0.5, playera 1.1, chamarra 0.95, tenis 2.2).
- **Imágenes**: solo el recorte `cutout_kind === 'mask'` se pinta como `<img>` sin marco; un recorte `bbox`, la foto original o la ausencia de foto usan un mosaico enmarcado como foto «prendida» (`.canvas-tile`, `tileIn` en `layout.ts`: ~80 % de la altura de su zona con la forma de la foto acotada a 0.55–1.8, anclado dentro de su zona —camisa en el torso, pantalón de la cintura al tobillo—, marco suave redondeado y un alfiler; con icono de lucide si no hay foto) para no cubrir el cuerpo con un rectángulo. La carga usa `useGarmentImages` / `useGarmentImage` (`src/components/useGarmentImage.ts`): URL de objeto desde `repo.getPhoto` más tamaño natural; `GarmentPhoto` no cambia.
- **Interacción**: cada prenda colocada es un `<button aria-label=nombre>`; debajo hay una fila de chips con los nombres. Ambos llaman a `onSelectGarment(id)` (abre «Cambiar <prenda>», ver «Edición y favoritos»).
- **Respaldo**: `canRenderCanvas` exige al menos una prenda de arriba o de abajo; si no, `OutfitVisual` usa la cuadrícula.
- **Colores y contraste**: solo tokens. `--mannequin-fill` (claro: mezcla suave de `--text` sobre `--surface-photo`; oscuro: gris medio-claro para que la ropa oscura se lea), `--cutout-edge` y `--cutout-shadow` (los recortes `mask` llevan `filter: drop-shadow` fino con borde claro en modo oscuro y sombra suave) y `--tile-frame` (marco claro del mosaico); se definen en el bloque base y en el bloque oscuro, así que valen para «Neutro» y «Cálido». Verificado con jeans negros y playera blanca en ambos temas, claro y oscuro.

## Edición y favoritos

Migración 0006 (solo hacia adelante, sin perder datos; `openSqlite` respalda antes de migrar): `garments.favorite` (0/1), `outfits.saved_at` y `outfits.name` (un outfit guardado es una fila de `outfits`), y `outfit_swaps` (cambios manuales, sin claves foráneas). El respaldo es la base completa, así que `schemaVersion` sigue a las migraciones y los respaldos v5 se importan y migran.

- **Cambiar una pieza** (`src/engine/alternatives.ts`, UI en `OutfitEditFlow` / `AlternativesPicker`): tocar una prenda del lienzo o su chip abre «Cambiar <prenda>» con las de la misma categoría (para accesorios, cualquier accesorio). Primero las válidas para la ocasión y el clima (mismo `filterGarments` y reglas estructurales de `validate.ts`, sin las de rotación), de la menos usada a la más usada; después «Otras» con el motivo («muy formal para gym», «muy abrigadora para 32°», «en lavandería», «ya hay una capa exterior»…), que se pueden elegir a mano. Retiradas y candidatas nunca aparecen; la lavandería solo en «Otras». «Barajar» elige una válida al azar; «Quitar» solo para capa exterior (si el clima no la exige) y accesorios (`canRemoveCategory`: arriba, abajo y calzado son obligatorios). «Añadir pieza» suma una capa (si no hay) o un accesorio (máx. 2). `validateManualOutfit` valida a mano con las reglas duras pero sin prioritaria, no repetir, pares evitados ni favorita; sin clima (`weather: null`) no filtra por abrigo.
- **Regla de edición** (`commitOutfitEdit`, `src/outfits/edit.ts`): si el outfit ya tiene una calificación o algún uso (`outfits.hasHistory`) NO se reescribe: se crea una fila nueva con `source = 'manual'` (y si la original estaba guardada, el guardado y su nombre pasan a la nueva) porque `wears` y `feedback` referencian `outfit_id`. Si no tiene historial se actualiza en su lugar (`outfits.updateItems`, también pasa a `manual`). En Hoy, si el outfit ya estaba marcado como usado hoy, el uso de hoy se mueve a la fila nueva para no contarlo dos veces.
- **Señal de gusto por cambios** (`outfit_swaps`, `computeManualScores` en `engine/taste.ts`): cada cambio guarda (quitada → elegida); +1 por prenda elegida a mano, −1 por prenda quitada, acotado a ±`MANUAL_SCORE_CAP` (3) y multiplicado por `MANUAL_WEIGHT` (2) en `scoreCombo` (como mucho ±24 por outfit frente a 100 de una prioritaria). Va en `TastePreferences.manualScores`; «Reiniciar gusto» la ignora igual que a las calificaciones. Solo orienta el compositor por reglas.
- **Favoritas**: corazón en las tarjetas de Armario y en el detalle (`repo.setFavorite`; `update` conserva la marca si no se indica), chip «Favoritas» en Armario. En Hoy, «Con una favorita» (`requireFavorite` en `localStorage`, por defecto apagado) agrega al motor la restricción «al menos una favorita» (cualquier categoría, accesorios incluidos): `Plan.requireFavorite`, validada en `validateOutfit`, el compositor por reglas agrega un accesorio favorito si la base no trae una, y el prompt del estilista recibe `favorite_required` y `favorite_ids`. Si es imposible (junto con prioritaria y demás reglas) `Plan.favoriteUnsatisfiable`: se ignora y se avisa.
- **Outfits guardados**: bookmark en la tarjeta (hoja con nombre opcional) → `outfits.save/unsave`; nunca se borran solos. Armario tiene dos segmentos, «Prendas» y «Outfits» (`SavedOutfitsList`: lienzo pequeño, nombre, último uso, «Usar hoy», «Editar», «Quitar de guardados»). «Crear outfit» (botón de Armario, `OutfitEditorSheet`, sin clima) arma arriba + abajo + calzado y piezas opcionales, lo guarda como `manual` y queda guardado. La regla de no repetir 14 días solo aplica a las sugerencias: usar un guardado hoy siempre se permite.
- **Lavandería rápida**: tras «Me lo pongo» (tarjeta) o «Usar hoy» (aviso con botón, `ToastProvider` admite una acción) «Mandar a lavandería» abre `LaundrySheet` con casillas (la prenda de arriba marcada) → `status = 'laundry'`. En Armario las prendas en lavandería llevan insignia y «Ya está limpia» (también en el detalle).
