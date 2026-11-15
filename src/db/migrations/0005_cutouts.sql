-- Fase 10: recorte sin fondo. `cutout_path` es la clave del recorte en el mismo almacén de fotos
-- (`cutout:<uuid>`); `cutout_kind` indica cómo se obtuvo: 'mask' (fondo transparente con el modelo en el
-- dispositivo) o 'bbox' (recorte rectangular con el cuadro que propuso la IA, sin transparencia).
-- Solo agrega columnas nulas: no cambia ni borra datos existentes. Antes de migrar se guarda un respaldo.
ALTER TABLE garments ADD COLUMN cutout_path TEXT;
ALTER TABLE garments ADD COLUMN cutout_kind TEXT CHECK (cutout_kind IN ('mask','bbox'));
