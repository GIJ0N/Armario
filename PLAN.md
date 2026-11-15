# Plan de construcción: app de armario con outfits por IA

## Resumen

App web personal, instalada en la pantalla de inicio del iPhone, para fotografiar la ropa, que la IA la etiquete sola y proponga cada día 3 outfits pensados por ocasión, clima, historial de uso y gusto aprendido. El objetivo medible es usar más prendas del armario, no solo combinar colores. También evalúa una prenda antes de comprarla y señala qué le falta al armario.

Sí hace falta IA, pero en dos lugares concretos y combinada con reglas:

- **Visión** para etiquetar cada prenda desde la foto (tipo, corte, material, formalidad, abrigo).
- **Un modelo de lenguaje como estilista** que arma el outfit razonando sobre silueta, formalidad, texturas y ocasión.
- **Código normal** para lo que debe ser exacto: filtrar por clima, rotar prendas poco usadas, no repetir outfits y validar la respuesta de la IA.

Decisiones ya tomadas:

| Tema | Decisión |
| --- | --- |
| Plataforma | Web instalable (PWA) en el iPhone, gratis y permanente |
| Registro | Foto y la IA etiqueta; el usuario solo corrige |
| Contexto del outfit | Ocasión, clima del día, historial de uso, feedback |
| Usuarios | Solo uno, sin login ni cuentas; base SQL dentro del iPhone |
| Costo de IA | Mínimo: capa gratuita con su propia API key |
| Accesorios | Entran desde la primera versión |
| Vestimenta en planta | Sin restricciones especiales |

## Stack técnico

La app es una web instalable (PWA): se abre una vez en Safari, se agrega a la pantalla de inicio y queda como app a pantalla completa. Todo vive en el iPhone, en una base SQLite: sin servidor, sin cuentas, sin pausas y sin pagos. Instalarla en la pantalla de inicio es obligatorio: las apps de pantalla de inicio quedan fuera de la regla de Safari que borra datos de sitios tras 7 días sin visita.

| Capa | Elección | Por qué |
| --- | --- | --- |
| App | Vite + React + TypeScript + React Router, con `vite-plugin-pwa` y `display: standalone` | Se instala desde Safari y abre sin conexión |
| Datos | SQLite en WebAssembly (`@sqlite.org/sqlite-wasm`) en memoria, con migraciones SQL; tras cada escritura se guarda la base completa como instantánea en IndexedDB y se restaura al abrir. Fotos como Blobs en IndexedDB. Todo detrás de una interfaz de repositorio | GitHub Pages no envía COOP/COEP y OPFS es irregular en iOS Safari; la instantánea persiste en cualquier navegador y el backend es reemplazable |
| Fotos | Campo de archivo con `accept="image/*"` y `capture`, reducidas a 1024 px y guardadas en el teléfono | Abre la cámara; también acepta capturas de tiendas en línea |
| Respaldo | Exporta un zip (base + fotos) con el menú Compartir de iOS (Web Share API) hacia Archivos o iCloud Drive; importar lo restaura | Gratis y bajo control del usuario |
| IA | Gemini API, modelo Flash de la capa gratuita (`gemini-3.8-flash` por defecto), con salida JSON estructurada | Acepta imágenes y no cobra dentro de sus límites |
| API key de Gemini | Se captura en Ajustes y se guarda solo en el dispositivo | Nunca va en el repositorio ni en el build publicado |
| Clima | Open-Meteo | Gratis y sin API key |
| Publicación | GitHub Pages con GitHub Actions (base path del repo) | Gratis; cada cambio en `main` publica la web |
| Calidad | Vitest, ESLint, `tsc`, GitHub Actions | El motor de outfits se prueba sin llamar a la IA |

El ID del modelo debe ser configurable en Ajustes: los modelos gratuitos de Gemini cambian con frecuencia.

## Modelo de datos

Seis tablas SQL en SQLite; la de prendas guarda los atributos que hacen posible un buen outfit, no solo el color. Los arreglos se guardan como JSON en columnas TEXT.

| Tabla | Campos clave |
| --- | --- |
| `garments` | `id`, `photo_path`, `category` (superior, inferior, calzado, capa exterior, accesorio), `subcategory`, `colors[]`, `pattern`, `material`, `fit` (ajustado, regular, holgado), `formality` 1–5, `warmth` 1–5, `occasions[]`, `is_statement`, `status` (activa, lavandería, retirada, candidata), `notes`, `created_at` |
| `outfits` | `id`, `garment_ids[]`, `occasion`, `weather_snapshot`, `reasoning`, `source` (ia, manual), `created_at` |
| `wears` | `id`, `outfit_id`, `date` |
| `feedback` | `id`, `outfit_id`, `rating` (me gusta, no me gusta), `tags[]`, `comment` |
| `taste_profile` | `summary` (texto), `updated_at` |
| `purchase_evaluations` | `garment_id`, `verdict`, `outfit_count`, `gaps[]`, `suggested_additions[]`, `created_at` |

Una prenda que el usuario piensa comprar se guarda en `garments` con `status = candidata`.

Valores derivados que se calculan, no se guardan: usos por prenda, días desde el último uso y porcentaje del armario usado en los últimos 30 días.

## Motor de outfits

El motor es híbrido: el código decide qué prendas son elegibles y cuáles urge usar, y la IA decide cómo combinarlas con criterio de estilista. Solo se envían atributos en JSON, no fotos.

1. **Filtrar (código).** Quita prendas en lavandería, retiradas o candidatas; las que no sirven para el clima del día (`warmth` contra temperatura y lluvia) y las que quedan fuera del rango de formalidad de la ocasión.
2. **Priorizar rotación (código).** Puntaje por prenda con usos totales y días desde el último uso. Las menos usadas son «prioritarias».
3. **Componer (IA).** El modelo recibe candidatas, ocasión, clima, perfil de gusto y los últimos outfits. Devuelve 3 outfits en JSON con IDs de prendas y una razón de una línea. Cada outfit debe incluir al menos una prenda prioritaria.
4. **Validar (código).** IDs existentes; una prenda por espacio (superior, inferior, calzado; capa exterior si hace frío; hasta 2 accesorios opcionales con la misma formalidad); no repetir un outfit de los últimos 14 días. Si falla, reintenta una vez con el error en el prompt.
5. **Aprender.** Cada 10 calificaciones, la IA resume el feedback en un perfil de gusto en texto. Ese perfil y 5 outfits con «me gusta» entran como ejemplos al prompt.

Principios del prompt del estilista, en este orden:

- **Formalidad coherente:** las prendas de un outfit no difieren más de 1 punto en la escala 1–5.
- **Silueta y proporción:** equilibrar holgado con ajustado.
- **Un solo protagonista:** máximo una prenda `is_statement` o un estampado fuerte.
- **Textura y material:** mezclar con intención y respetar el clima.
- **Calzado como ancla:** define el nivel de formalidad y debe coincidir con la ocasión.
- **Color al final:** paleta de 2 a 3 tonos con neutros como base; un criterio más, no el único.

Sin internet o con el límite gratuito agotado, la app arma outfits solo con los pasos 1, 2 y 4 más las reglas de formalidad y de un protagonista.

## Evaluador de compras

El usuario sube foto o captura de una prenda que piensa comprar y la app responde con un veredicto, los outfits que formaría con su armario y qué más necesitaría.

1. **Etiquetar.** La misma IA de registro llena la ficha de la candidata.
2. **Detectar duplicado (código).** 2 o más prendas con la misma subcategoría, color y formalidad → aviso.
3. **Simular (motor).** Corre el motor para cada ocasión obligando a incluir la candidata; cuenta outfits válidos y prendas distintas con las que combina.
4. **Veredicto.** «Cómprala» con 5+ outfits en al menos 2 ocasiones; «Solo con complementos» con 1 a 4; «No te conviene» con 0 o si es duplicado. Umbrales ajustables en Ajustes.
5. **Huecos y complementos (IA + motor).** La IA explica qué falta y propone hasta 3 prendas descritas por atributos, sin marcas ni enlaces. El motor simula cada una y muestra cuántos outfits adicionales desbloquea.
6. **Guardar.** La candidata queda en lista de deseos; si la compra, un toque la pasa a activa.

La misma lógica, sin candidata, alimenta «Qué le falta a mi armario»: las 3 prendas que más outfits nuevos desbloquearían.

## Pantallas

Seis pantallas (pestañas), con «Hoy» como inicio. Toda la interfaz en español, diseño móvil primero.

| Pantalla | Qué hace |
| --- | --- |
| Hoy | Elige ocasión, muestra clima y 3 outfits con su razón. «Me lo pongo», me gusta / no me gusta con motivos rápidos, «Otras opciones» |
| Armario | Cuadrícula de prendas con filtros por categoría y estado; «en lavandería» con un toque |
| Agregar | Cámara o galería; la IA llena la ficha y el usuario confirma o corrige |
| Comprar | Prenda candidata: veredicto, outfits, huecos, complementos; lista de deseos |
| Uso | Menos usadas, usos por prenda, % del armario usado en 30 días, historial, «Qué le falta a mi armario» |
| Ajustes | API key, modelo, ciudad para el clima, ocasiones, umbrales del evaluador, respaldo |

Ocasiones iniciales: trabajo en planta, oficina, gym, casual, cita, evento formal.

## Fases de construcción

Ocho fases, una por pull request; cada una deja la app funcionando.

0. **Repositorio.** Vite (React + TS), `vite-plugin-pwa`, React Router, ESLint, Vitest, CI (lint, `tsc`, pruebas, build) y despliegue a GitHub Pages, `CLAUDE.md`. Aceptación: CI en verde; la web publicada abre en Safari del iPhone, se agrega a la pantalla de inicio y muestra 6 pestañas vacías.
1. **Armario manual.** SQLite WASM con migraciones SQL, fotos en el teléfono, alta/edición/baja con ficha manual, cuadrícula con filtros. Aceptación: registrar 10 prendas, cerrar la app y verlas al reabrir.
2. **Etiquetado con IA.** `AiProvider` con Gemini y uno simulado; foto reducida a 1024 px; respuesta validada contra esquema; pantalla de revisión. Aceptación: una foto produce la ficha completa en menos de 10 s; un error de red deja llenarla a mano.
3. **Motor de outfits.** Pasos 1 a 4 como funciones puras con pruebas, cliente Open-Meteo, pantalla Hoy. Aceptación: 3 outfits válidos por ocasión con 30 prendas de prueba; ninguna prueba unitaria llama a la red.
4. **Historial y rotación.** «Me lo pongo», `wears`, puntaje de rotación, pantalla Uso. Aceptación: tras simular 30 días, ningún outfit se repite en 14 días y cada sugerencia incluye una prioritaria.
5. **Feedback y gusto.** Calificación con motivos, perfil de gusto cada 10 calificaciones, ejemplos en el prompt. Aceptación: tras 10 «no me gusta» por «muy formal», baja la formalidad promedio sugerida.
6. **Cierre.** Modo sin conexión, exportar/importar respaldo (zip), ícono, recordatorio semanal de respaldo, aviso si se abre desde Safari en vez de la pantalla de inicio. Aceptación: abre en modo avión con todo el armario y el respaldo se restaura en una instalación limpia.
7. **Evaluador de compras.** Estado `candidata`, `purchase_evaluations`, simulación con prenda obligatoria, duplicados, veredicto, complementos simulados, pantalla Comprar, «Qué le falta a mi armario». Aceptación: con el armario de prueba, un duplicado recibe «No te conviene» y cada complemento muestra cuántos outfits desbloquea.

## Repositorio

```
src/pages/           pantallas: hoy, armario, agregar, comprar, uso, ajustes
src/db/              SQLite (WASM), migraciones SQL, consultas, respaldo e importación
src/engine/          filtrar, rotación, validar, modo sin conexión (funciones puras)
src/purchase/        evaluador de compras: duplicados, simulación, veredicto
src/ai/              AiProvider, cliente Gemini, proveedor simulado
src/ai/prompts/      prompts de etiquetado, estilista, perfil de gusto y huecos
src/weather/         cliente Open-Meteo
src/components/      tarjetas de prenda y de outfit
tests/               pruebas del motor, del evaluador y de los esquemas
.github/workflows/   CI y despliegue a GitHub Pages
CLAUDE.md            reglas para el agente
```

## Reglas para el agente

- Una fase por pull request; no empezar la siguiente sin cumplir la aceptación.
- Ninguna API key, foto personal ni base de datos en el repositorio.
- Todo lo que llama a la IA pasa por `AiProvider`; las pruebas usan el proveedor simulado.
- Toda respuesta de la IA se valida contra un esquema antes de tocar la base de datos.
- Los prompts viven en `src/ai/prompts/` como archivos propios.
- Las migraciones SQL solo avanzan y ninguna borra datos sin generar antes un respaldo.
- Textos de interfaz en español; código y nombres en inglés.

## Riesgos

- **Límites de la capa gratuita de Gemini:** variables; uso previsto bajo (1 llamada por prenda, 1–3 por día).
- **Privacidad:** en la capa gratuita Google puede usar lo enviado; solo se manda la foto al etiquetar y después atributos en texto.
- **Calidad del etiquetado:** la pantalla de revisión es obligatoria.
- **Datos locales:** borrar la app los elimina; el respaldo semanal lo cubre.
