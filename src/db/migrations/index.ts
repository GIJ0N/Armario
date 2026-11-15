import init0001 from './0001_init.sql?raw'
import outfitSource0002 from './0002_outfit_source_rules.sql?raw'
import feedbackTaste0003 from './0003_feedback_taste.sql?raw'
import purchase0004 from './0004_purchase_evaluations.sql?raw'
import cutouts0005 from './0005_cutouts.sql?raw'
import favorites0006 from './0006_favorites_saved_swaps.sql?raw'
import canvasAdjust0007 from './0007_canvas_adjust.sql?raw'
import planned0008 from './0008_planned_outfits.sql?raw'

/** Solo se agregan al final; el índice + 1 es el valor de PRAGMA user_version. Nunca se editan ni se borran. */
export const MIGRATIONS: readonly string[] = [init0001, outfitSource0002, feedbackTaste0003, purchase0004, cutouts0005, favorites0006, canvasAdjust0007, planned0008]
