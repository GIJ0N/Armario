-- Fase 13a: lienzo ajustable.
-- Solo agrega columnas nulas (JSON): no cambia ni borra datos existentes. Antes de migrar se guarda un respaldo (openSqlite).
-- `garments.canvas_adjust`: {"scale","dx","dy"} respecto a la caja automática, válido en todos los outfits de la prenda.
ALTER TABLE garments ADD COLUMN canvas_adjust TEXT;
-- `outfits.canvas_layout`: mapa id de prenda -> {"dx","dy","scale","z"}, solo para ese outfit.
ALTER TABLE outfits ADD COLUMN canvas_layout TEXT;
