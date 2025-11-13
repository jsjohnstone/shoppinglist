import express from 'express';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();

// Get all API keys
router.get('/', authenticateToken, async (req, res) => {
  try {
    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      key: apiKeys.key,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .orderBy(apiKeys.createdAt);

    res.json(keys);
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create new API key
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate a random API key
    const key = crypto.randomBytes(32).toString('hex');

    const [newKey] = await db.insert(apiKeys)
      .values({
        name,
        key,
      })
      .returning();

    res.status(201).json(newKey);
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete API key
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [deletedKey] = await db.delete(apiKeys)
      .where(eq(apiKeys.id, parseInt(id)))
      .returning();

    if (!deletedKey) {
      return res.status(404).json({ error: 'API key not found' });
    }

    res.json({ message: 'API key deleted successfully' });
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export default router;
