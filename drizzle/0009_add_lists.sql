-- Create lists table
CREATE TABLE IF NOT EXISTS lists (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default list
INSERT INTO lists (id, name, sort_order) VALUES (1, 'Shopping List', 0)
ON CONFLICT DO NOTHING;

-- Ensure the sequence is past id=1
SELECT setval('lists_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM lists), 1));

-- Add list_id to items with default pointing to the default list
ALTER TABLE items ADD COLUMN IF NOT EXISTS list_id INTEGER REFERENCES lists(id) DEFAULT 1;

-- Backfill all existing items to the default list
UPDATE items SET list_id = 1 WHERE list_id IS NULL;
