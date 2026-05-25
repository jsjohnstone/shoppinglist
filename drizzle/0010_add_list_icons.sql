-- Add icon column to lists table
ALTER TABLE lists ADD COLUMN IF NOT EXISTS icon TEXT;
