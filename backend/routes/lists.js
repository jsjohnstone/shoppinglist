import express from 'express';
import { db } from '../db/index.js';
import { lists, items } from '../db/schema.js';
import { eq, asc, count } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.get('/', authenticateToken, async (req, res) => {
  try {
    const allLists = await db.select()
      .from(lists)
      .orderBy(asc(lists.sortOrder), asc(lists.name));

    res.json(allLists);
  } catch (error) {
    console.error('Error fetching lists:', error);
    res.status(500).json({ error: 'Failed to fetch lists' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, icon } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'List name is required' });
    }

    const maxOrder = await db.select({ max: lists.sortOrder })
      .from(lists)
      .limit(1);
    const nextOrder = (maxOrder[0]?.max || 0) + 1;

    const [newList] = await db.insert(lists)
      .values({ name: name.trim(), icon: icon || null, sortOrder: nextOrder })
      .returning();

    res.status(201).json(newList);
  } catch (error) {
    console.error('Error creating list:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'List name is required' });
    }

    const updateData = { name: name.trim() };
    if (icon !== undefined) updateData.icon = icon || null;

    const [updated] = await db.update(lists)
      .set(updateData)
      .where(eq(lists.id, parseInt(id)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: 'List not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Error updating list:', error);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const listId = parseInt(id);

    const allLists = await db.select().from(lists);
    if (allLists.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last list' });
    }

    const defaultList = allLists.find(l => l.id !== listId);

    await db.update(items)
      .set({ listId: defaultList.id })
      .where(eq(items.listId, listId));

    const [deleted] = await db.delete(lists)
      .where(eq(lists.id, listId))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: 'List not found' });
    }

    res.json({ message: 'List deleted successfully', itemsMovedTo: defaultList.id });
  } catch (error) {
    console.error('Error deleting list:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

router.post('/reorder', authenticateToken, async (req, res) => {
  try {
    const { listOrders } = req.body;

    if (!Array.isArray(listOrders)) {
      return res.status(400).json({ error: 'listOrders must be an array' });
    }

    await Promise.all(
      listOrders.map(({ id, sortOrder }) =>
        db.update(lists)
          .set({ sortOrder })
          .where(eq(lists.id, parseInt(id)))
      )
    );

    res.json({ message: 'Lists reordered successfully' });
  } catch (error) {
    console.error('Error reordering lists:', error);
    res.status(500).json({ error: 'Failed to reorder lists' });
  }
});

export default router;
