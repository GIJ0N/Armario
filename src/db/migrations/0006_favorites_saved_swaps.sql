-- Fase 12: prendas favoritas, outfits guardados y señales de cambios manuales.
-- Solo agrega columnas con valor por defecto/nulas y una tabla nueva: no cambia ni borra datos existentes.
-- Antes de migrar se guarda un respaldo (openSqlite).
ALTER TABLE garments ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1));
-- Un outfit guardado es una fila de `outfits` con `saved_at`; `name` es opcional.
ALTER TABLE outfits ADD COLUMN saved_at TEXT;
ALTER TABLE outfits ADD COLUMN name TEXT;
CREATE INDEX idx_outfits_saved ON outfits (saved_at);
-- Cada cambio manual: `from_garment_id` = prenda que se quitó (null si solo se agregó) y
-- `to_garment_id` = prenda elegida (null si solo se quitó). Sin claves foráneas: las prendas pueden borrarse
-- y el historial de señales se ignora para ids que ya no existen.
CREATE TABLE outfit_swaps (
  id TEXT PRIMARY KEY,
  outfit_id TEXT,
  from_garment_id TEXT,
  to_garment_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_outfit_swaps_created ON outfit_swaps (created_at);
