-- Fase 7: el veredicto «accessories_only» pasa a llamarse «with_complements» y cada evaluación guarda un
-- resumen en JSON (`details`). SQLite no puede modificar un CHECK: se reconstruye la tabla copiando TODAS las
-- filas (accessories_only -> with_complements); no se pierde ningún dato. El corredor de migraciones corre con
-- foreign_keys apagado, así que el DROP no dispara ON DELETE CASCADE. Antes de migrar se guarda un respaldo.
CREATE TABLE purchase_evaluations_new (
  garment_id TEXT NOT NULL REFERENCES garments (id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('buy','with_complements','skip')),
  outfit_count INTEGER NOT NULL CHECK (outfit_count >= 0),
  gaps TEXT NOT NULL DEFAULT '[]',
  suggested_additions TEXT NOT NULL DEFAULT '[]',
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
INSERT INTO purchase_evaluations_new (garment_id, verdict, outfit_count, gaps, suggested_additions, details, created_at)
  SELECT garment_id,
         CASE verdict WHEN 'accessories_only' THEN 'with_complements' ELSE verdict END,
         outfit_count, gaps, suggested_additions, '{}', created_at
  FROM purchase_evaluations;
DROP TABLE purchase_evaluations;
ALTER TABLE purchase_evaluations_new RENAME TO purchase_evaluations;
CREATE INDEX idx_purchase_garment ON purchase_evaluations (garment_id);
