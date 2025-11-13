import express from 'express';
import { db } from '../db/index.js';
import { haConfig, ttsPhrases } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { haService } from '../services/homeassistant.js';

const router = express.Router();

// Get Home Assistant configuration (admin only)
router.get('/homeassistant', authenticateToken, async (req, res) => {
  try {
    const [config] = await db
      .select({
        id: haConfig.id,
        ha_url: haConfig.haUrl,
        ha_token: haConfig.haToken,
        default_tts_service: haConfig.defaultTtsService,
        created_at: haConfig.createdAt,
        updated_at: haConfig.updatedAt,
      })
      .from(haConfig)
      .limit(1);

    if (!config) {
      return res.json({ configured: false });
    }

    // Don't expose full token, just indicate it exists
    res.json({
      configured: true,
      ha_url: config.ha_url,
      has_token: !!config.ha_token,
      default_tts_service: config.default_tts_service,
      updated_at: config.updated_at,
    });
  } catch (error) {
    console.error('Error fetching HA config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Update Home Assistant configuration (admin only)
router.put('/homeassistant', authenticateToken, async (req, res) => {
  try {
    const { ha_url, ha_token, default_tts_service } = req.body;

    if (!ha_url || !ha_token) {
      return res.status(400).json({ 
        error: 'ha_url and ha_token are required' 
      });
    }

    // Check if config exists
    const [existingConfig] = await db
      .select()
      .from(haConfig)
      .limit(1);

    let savedConfig;

    if (existingConfig) {
      // Update existing
      [savedConfig] = await db
        .update(haConfig)
        .set({
          haUrl: ha_url,
          haToken: ha_token,
          defaultTtsService: default_tts_service || 'tts.google_translate_say',
          updatedAt: new Date(),
        })
        .where(eq(haConfig.id, existingConfig.id))
        .returning();
    } else {
      // Create new
      [savedConfig] = await db
        .insert(haConfig)
        .values({
          haUrl: ha_url,
          haToken: ha_token,
          defaultTtsService: default_tts_service || 'tts.google_translate_say',
        })
        .returning();
    }

    // Clear HA service cache so it picks up new config
    haService.clearCache();

    console.log('Home Assistant configuration updated');

    res.json({
      configured: true,
      ha_url: savedConfig.haUrl,
      has_token: true,
      default_tts_service: savedConfig.defaultTtsService,
      updated_at: savedConfig.updatedAt,
    });
  } catch (error) {
    console.error('Error updating HA config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Delete Home Assistant configuration (admin only)
router.delete('/homeassistant', authenticateToken, async (req, res) => {
  try {
    await db.delete(haConfig);
    haService.clearCache();
    
    console.log('Home Assistant configuration deleted');
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting HA config:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

// Get all TTS phrases (admin only)
router.get('/tts-phrases', authenticateToken, async (req, res) => {
  try {
    const phrases = await db
      .select({
        id: ttsPhrases.id,
        phrase_key: ttsPhrases.phraseKey,
        template: ttsPhrases.template,
        created_at: ttsPhrases.createdAt,
      })
      .from(ttsPhrases);

    res.json(phrases);
  } catch (error) {
    console.error('Error fetching TTS phrases:', error);
    res.status(500).json({ error: 'Failed to fetch phrases' });
  }
});

// Update a TTS phrase (admin only)
router.put('/tts-phrases/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params;
    const { template } = req.body;

    if (!template) {
      return res.status(400).json({ error: 'template is required' });
    }

    // Check if phrase exists
    const [existingPhrase] = await db
      .select()
      .from(ttsPhrases)
      .where(eq(ttsPhrases.phraseKey, key))
      .limit(1);

    let savedPhrase;

    if (existingPhrase) {
      // Update existing
      [savedPhrase] = await db
        .update(ttsPhrases)
        .set({ template })
        .where(eq(ttsPhrases.phraseKey, key))
        .returning();
    } else {
      // Create new
      [savedPhrase] = await db
        .insert(ttsPhrases)
        .values({
          phraseKey: key,
          template,
        })
        .returning();
    }

    console.log(`TTS phrase updated: ${key}`);

    res.json({
      phrase_key: savedPhrase.phraseKey,
      template: savedPhrase.template,
    });
  } catch (error) {
    console.error('Error updating TTS phrase:', error);
    res.status(500).json({ error: 'Failed to update phrase' });
  }
});

// Reset TTS phrases to defaults (admin only)
router.post('/tts-phrases/reset', authenticateToken, async (req, res) => {
  try {
    // Delete all existing phrases
    await db.delete(ttsPhrases);

    // Insert defaults
    const defaultPhrases = [
      { phraseKey: 'success', template: '{{itemName}} added to the shopping list' },
      { phraseKey: 'not_found', template: 'Unknown item, please add manually via the shopping list app' },
      { phraseKey: 'error', template: 'Error processing barcode, please try again' },
    ];

    const inserted = await db
      .insert(ttsPhrases)
      .values(defaultPhrases)
      .returning();

    console.log('TTS phrases reset to defaults');

    res.json(inserted);
  } catch (error) {
    console.error('Error resetting TTS phrases:', error);
    res.status(500).json({ error: 'Failed to reset phrases' });
  }
});

export default router;
