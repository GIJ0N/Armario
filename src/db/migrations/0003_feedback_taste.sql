-- Fase 5: la calificación guarda cuándo se hizo (para contar «cada 10 calificaciones») y es única por outfit.
-- ADD COLUMN y CREATE INDEX no borran ni reescriben filas existentes.
ALTER TABLE feedback ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX idx_feedback_outfit_unique ON feedback (outfit_id);
-- Marca de «Reiniciar gusto»: las calificaciones anteriores se conservan pero dejan de influir.
ALTER TABLE taste_profile ADD COLUMN reset_at TEXT NOT NULL DEFAULT '';
