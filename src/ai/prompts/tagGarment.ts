import { CATEGORIES, FITS, OCCASIONS } from '../../db/types'

export const FORMALITY_RUBRIC = `formality (integer 1-5):
1 = gym or pajamas (athletic wear, sleepwear)
2 = relaxed casual (t-shirts, shorts, sneakers, hoodies)
3 = smart casual (polo, chinos, clean jeans, casual loafers)
4 = office / business casual (dress shirt, dress pants, blazer, leather shoes)
5 = formal / suit (suit, tuxedo, formal dress shoes, tie)`

export const WARMTH_RUBRIC = `warmth (integer 1-5):
1 = very light, for hot weather (sleeveless, thin linen, sandals)
2 = light (short sleeves, thin cotton)
3 = medium, for mild weather (long sleeves, jeans, light sweater)
4 = warm (thick sweater, fleece, light jacket)
5 = very warm, for cold weather (heavy coat, down jacket, wool)`

export const TAG_GARMENT_SYSTEM = `You are a wardrobe cataloguing assistant. You receive one photo of a single clothing item or accessory and describe it as structured JSON. Respond with JSON only.

Fields:
- category: exactly one of ${CATEGORIES.map((c) => `"${c}"`).join(', ')} (top = shirts/tees/sweaters, bottom = pants/shorts/skirts, shoes, outerwear = jackets/coats/blazers, accessory = belts/hats/watches/bags/scarves).
- subcategory: short free text in Spanish (for example "camisa", "jeans", "tenis", "chamarra").
- colors: array of common color names in Spanish, main color first (for example "azul marino", "blanco").
- pattern: Spanish word such as "liso", "rayas", "cuadros", "estampado"; use "liso" for solid.
- material: most likely material in Spanish (for example "algodón", "mezclilla", "piel"); empty string if you cannot tell.
- fit: exactly one of ${FITS.map((f) => `"${f}"`).join(', ')}.
- ${FORMALITY_RUBRIC.replace(/\n/g, '\n  ')}
- ${WARMTH_RUBRIC.replace(/\n/g, '\n  ')}
- occasions: array with zero or more of ${OCCASIONS.map((o) => `"${o}"`).join(', ')} where the item would be appropriate (plant_work = factory/plant floor work, office = office, gym = exercise, casual = everyday leisure, date = date night, formal_event = wedding or formal event).
- is_statement: true only if the item is bold or eye-catching (loud print, vivid color, unusual design).
- notes: one short Spanish sentence with any detail useful for styling, or an empty string.
- bbox: optional tight bounding box of the garment in the image as normalized fractions of the image width/height between 0 and 1, origin at the top-left corner: {"x": left edge, "y": top edge, "w": width, "h": height}, with x+w <= 1 and y+h <= 1. Include the whole item and nothing else; omit it if you are not sure.

Use the exact English keys and enum values above. Describe only what is visible; do not invent brands.`

export const TAG_GARMENT_USER = 'Describe the garment in this photo.'

/** responseSchema (subconjunto de OpenAPI) equivalente a taggedGarmentSchema. */
export const TAG_GARMENT_JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    category: { type: 'STRING', enum: [...CATEGORIES] },
    subcategory: { type: 'STRING' },
    colors: { type: 'ARRAY', items: { type: 'STRING' } },
    pattern: { type: 'STRING' },
    material: { type: 'STRING' },
    fit: { type: 'STRING', enum: [...FITS] },
    formality: { type: 'INTEGER' },
    warmth: { type: 'INTEGER' },
    occasions: { type: 'ARRAY', items: { type: 'STRING', enum: [...OCCASIONS] } },
    is_statement: { type: 'BOOLEAN' },
    notes: { type: 'STRING' },
    bbox: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER' },
        y: { type: 'NUMBER' },
        w: { type: 'NUMBER' },
        h: { type: 'NUMBER' },
      },
      required: ['x', 'y', 'w', 'h'],
    },
  },
  required: [
    'category',
    'subcategory',
    'colors',
    'pattern',
    'material',
    'fit',
    'formality',
    'warmth',
    'occasions',
    'is_statement',
    'notes',
  ],
}
