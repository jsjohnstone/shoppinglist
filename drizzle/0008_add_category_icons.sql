-- Migration to add icon and color fields to categories
-- Add icon and color columns
ALTER TABLE categories ADD COLUMN icon VARCHAR(50);
ALTER TABLE categories ADD COLUMN color VARCHAR(7);

-- Set defaults for existing categories
UPDATE categories SET icon = 'Apple', color = '#10b981' WHERE name = 'Fresh Food';
UPDATE categories SET icon = 'Carrot', color = '#10b981' WHERE name = 'Vegetables';
UPDATE categories SET icon = 'Apple', color = '#ef4444' WHERE name = 'Fruit';
UPDATE categories SET icon = 'Beef', color = '#dc2626' WHERE name = 'Meat';
UPDATE categories SET icon = 'Milk', color = '#3b82f6' WHERE name = 'Dairy';
UPDATE categories SET icon = 'Snowflake', color = '#60a5fa' WHERE name = 'Frozen';
UPDATE categories SET icon = 'Croissant', color = '#d97706' WHERE name = 'Bakery';
UPDATE categories SET icon = 'Package', color = '#8b5cf6' WHERE name = 'Pantry';
UPDATE categories SET icon = 'Cookie', color = '#f59e0b' WHERE name = 'Snacks';
UPDATE categories SET icon = 'Coffee', color = '#6366f1' WHERE name = 'Beverages';
UPDATE categories SET icon = 'Sparkles', color = '#6b7280' WHERE name = 'Household';
UPDATE categories SET icon = 'Sparkles', color = '#ec4899' WHERE name = 'Personal Care';
