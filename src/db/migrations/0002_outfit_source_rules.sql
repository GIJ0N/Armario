-- Permite source = 'rules' (outfits armados por el motor sin IA).
-- SQLite no puede modificar un CHECK: se reconstruye la tabla copiando todas las filas (no se pierde ningún dato).
-- Las tablas wears y feedback referencian outfits(id) por nombre; el corredor de migraciones corre con
-- foreign_keys apagado (se activa después de migrar), así que el DROP no dispara ON DELETE CASCADE.
CREATE TABLE outfits_new (
  id TEXT PRIMARY KEY,
  garment_ids TEXT NOT NULL DEFAULT '[]',
  occasion TEXT NOT NULL,
  weather_snapshot TEXT,
  reasoning TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('ai','manual','rules')),
  created_at TEXT NOT NULL
);
INSERT INTO outfits_new (id, garment_ids, occasion, weather_snapshot, reasoning, source, created_at)
  SELECT id, garment_ids, occasion, weather_snapshot, reasoning, source, created_at FROM outfits;
DROP TABLE outfits;
ALTER TABLE outfits_new RENAME TO outfits;
CREATE INDEX idx_outfits_created ON outfits (created_at);
