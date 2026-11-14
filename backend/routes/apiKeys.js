import express from 'express';
import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { hashApiKey, apiKeyLastFour } from '../services/apiKeys.js';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '../middleware/auth.js';
import crypto from 'crypto';

const router = express.Router();

// Get all API keys
router.get('/', requireAdmin, async (req, res) => {
  try {
    // Only hashes are stored, so the keys themselves are never returned here -
    // just the last four characters to tell them apart
    const keys = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyLastFour: apiKeys.keyLastFour,
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
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate a random API key and store only its hash
    const key = crypto.randomBytes(32).toString('hex');

    const [newKey] = await db.insert(apiKeys)
      .values({
        name,
        keyHash: hashApiKey(key),
        keyLastFour: apiKeyLastFour(key),
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        keyLastFour: apiKeys.keyLastFour,
        createdAt: apiKeys.createdAt,
      });

    // This response is the only time the full key is available
    res.status(201).json({ ...newKey, key });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete API key
router.delete('/:id', requireAdmin, async (req, res) => {
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
