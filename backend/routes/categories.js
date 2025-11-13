import express from 'express';
import { db } from '../db/index.js';
import { categories, items } from '../db/schema.js';
import { eq, asc } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all categories
router.get('/', authenticateToken, async (req, res) => {
  try {
    const allCategories = await db.select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    res.json(allCategories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Create category
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, sortOrder, icon, color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const [newCategory] = await db.insert(categories)
      .values({
        name,
        sortOrder: sortOrder || 0,
        icon: icon || null,
        color: color || null,
      })
      .returning();

    res.status(201).json(newCategory);
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Category already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create category' });
    }
  }
});

// Update category
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, sortOrder, icon, color } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;

    const [updatedCategory] = await db.update(categories)
      .set(updateData)
      .where(eq(categories.id, parseInt(id)))
      .returning();

    if (!updatedCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(updatedCategory);
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// Delete category
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category is used by any items
    const itemsWithCategory = await db.select()
      .from(items)
      .where(eq(items.categoryId, parseInt(id)))
      .limit(1);

    if (itemsWithCategory.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete category that is in use by items' 
      });
    }

    const [deletedCategory] = await db.delete(categories)
      .where(eq(categories.id, parseInt(id)))
      .returning();

    if (!deletedCategory) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// Reorder categories
router.post('/reorder', authenticateToken, async (req, res) => {
  try {
    const { categoryOrders } = req.body; // Array of { id, sortOrder }

    if (!Array.isArray(categoryOrders)) {
      return res.status(400).json({ error: 'categoryOrders must be an array' });
    }

    // Update each category's sort order
    await Promise.all(
      categoryOrders.map(({ id, sortOrder }) =>
        db.update(categories)
          .set({ sortOrder })
          .where(eq(categories.id, parseInt(id)))
      )
    );

    res.json({ message: 'Categories reordered successfully' });
  } catch (error) {
    console.error('Error reordering categories:', error);
    res.status(500).json({ error: 'Failed to reorder categories' });
  }
});

export default router;
