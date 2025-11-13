-- Migration to update categories
-- Rename 'Pantry Aisles' to 'Pantry' and add new categories

-- Rename existing 'Pantry Aisles' to 'Pantry'
UPDATE categories SET name = 'Pantry' WHERE name = 'Pantry Aisles';

-- Add new categories if they don't exist
INSERT INTO categories (name, sort_order) VALUES ('Fresh Food', 1)
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, sort_order) VALUES ('Frozen', 6)
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, sort_order) VALUES ('Snacks', 9)
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, sort_order) VALUES ('Beverages', 10)
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, sort_order) VALUES ('Personal Care', 12)
ON CONFLICT (name) DO NOTHING;

-- Update sort orders to reflect new organization
UPDATE categories SET sort_order = 2 WHERE name = 'Vegetables';
UPDATE categories SET sort_order = 3 WHERE name = 'Fruit';
UPDATE categories SET sort_order = 4 WHERE name = 'Meat';
UPDATE categories SET sort_order = 5 WHERE name = 'Dairy';
UPDATE categories SET sort_order = 7 WHERE name = 'Bakery';
UPDATE categories SET sort_order = 8 WHERE name = 'Pantry';
UPDATE categories SET sort_order = 11 WHERE name = 'Household';
