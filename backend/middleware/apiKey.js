import { db } from '../db/index.js';
import { apiKeys } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function authenticateApiKey(req, res, next) {
  // Support both X-API-Key header and Authorization Bearer header
  let apiKey = req.headers['x-api-key'];
  
  // If X-API-Key not present, check for Authorization Bearer
  if (!apiKey) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      apiKey = authHeader.substring(7); // Remove 'Bearer ' prefix
    }
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.key, apiKey)).limit(1);
    
    if (!key) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    req.apiKey = key;
    next();
  } catch (error) {
    console.error('API key authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
