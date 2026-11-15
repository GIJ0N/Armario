-- Fase 13b: calendario y plan de outfits.
-- Solo agrega una tabla y un índice: no cambia ni borra datos existentes. Antes de migrar se guarda un respaldo (openSqlite).
-- Un outfit planeado es una fila de `planned_outfits` que apunta a una fila de `outfits` para una fecha local (AAAA-MM-DD).
-- Como en `wears`, la clave foránea borra el plan si se borra el outfit (PRAGMA foreign_keys = ON al abrir la base);
-- ninguna limpieza de la app borra outfits.
CREATE TABLE planned_outfits (
  id TEXT PRIMARY KEY,
  outfit_id TEXT NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  occasion TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (outfit_id, date)
);
CREATE INDEX idx_planned_outfits_date ON planned_outfits (date);
