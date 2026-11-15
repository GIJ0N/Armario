CREATE TABLE garments (
  id TEXT PRIMARY KEY,
  photo_path TEXT,
  category TEXT NOT NULL CHECK (category IN ('top','bottom','shoes','outerwear','accessory')),
  subcategory TEXT NOT NULL DEFAULT '',
  colors TEXT NOT NULL DEFAULT '[]',
  pattern TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  fit TEXT NOT NULL DEFAULT 'regular' CHECK (fit IN ('fitted','regular','loose')),
  formality INTEGER NOT NULL CHECK (formality BETWEEN 1 AND 5),
  warmth INTEGER NOT NULL CHECK (warmth BETWEEN 1 AND 5),
  occasions TEXT NOT NULL DEFAULT '[]',
  is_statement INTEGER NOT NULL DEFAULT 0 CHECK (is_statement IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','laundry','retired','candidate')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_garments_category ON garments (category);
CREATE INDEX idx_garments_status ON garments (status);

CREATE TABLE outfits (
  id TEXT PRIMARY KEY,
  garment_ids TEXT NOT NULL DEFAULT '[]',
  occasion TEXT NOT NULL,
  weather_snapshot TEXT,
  reasoning TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('ai','manual')),
  created_at TEXT NOT NULL
);

CREATE TABLE wears (
  id TEXT PRIMARY KEY,
  outfit_id TEXT NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
  date TEXT NOT NULL
);
CREATE INDEX idx_wears_outfit ON wears (outfit_id);

CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  outfit_id TEXT NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('like','dislike')),
  tags TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_feedback_outfit ON feedback (outfit_id);

CREATE TABLE taste_profile (
  summary TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE purchase_evaluations (
  garment_id TEXT NOT NULL REFERENCES garments (id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('buy','accessories_only','skip')),
  outfit_count INTEGER NOT NULL CHECK (outfit_count >= 0),
  gaps TEXT NOT NULL DEFAULT '[]',
  suggested_additions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_purchase_garment ON purchase_evaluations (garment_id);
