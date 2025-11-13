import express from 'express';
import { db } from '../db/index.js';
import { settings, ttsPhrases } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { haService } from '../services/homeassistant.js';
import axios from 'axios';

const router = express.Router();

// Helper function to get a setting value
async function getSetting(key, defaultValue = null) {
  const [setting] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  
  return setting?.value ?? defaultValue;
}

// Helper function to set a setting value
async function setSetting(key, value) {
  const [existing] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  if (existing) {
    await db
      .update(settings)
      .set({ value, updatedAt: new Date() })
      .where(eq(settings.key, key));
  } else {
    await db
      .insert(settings)
      .values({ key, value });
  }
}

// Get all settings (admin only)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const allSettings = await db.select().from(settings);
    
    // Convert to object, hiding sensitive values
    const settingsObj = {};
    for (const setting of allSettings) {
      if (setting.key === 'ha_token') {
        settingsObj[setting.key] = setting.value ? '***HIDDEN***' : null;
      } else {
        settingsObj[setting.key] = setting.value;
      }
    }

    res.json(settingsObj);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get Home Assistant configuration (admin only)
router.get('/homeassistant', authenticateToken, async (req, res) => {
  try {
    const ha_url = await getSetting('ha_url');
    const ha_token = await getSetting('ha_token');
    const ha_tts_service = await getSetting('ha_tts_service', 'tts.google_translate_say');

    if (!ha_url || !ha_token) {
      return res.json({ configured: false });
    }

    res.json({
      configured: true,
      ha_url,
      has_token: !!ha_token,
      default_tts_service: ha_tts_service,
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

    await setSetting('ha_url', ha_url);
    await setSetting('ha_token', ha_token);
    await setSetting('ha_tts_service', default_tts_service || 'tts.google_translate_say');

    // Clear HA service cache so it picks up new config
    haService.clearCache();

    console.log('Home Assistant configuration updated');

    res.json({
      configured: true,
      ha_url,
      has_token: true,
      default_tts_service: default_tts_service || 'tts.google_translate_say',
    });
  } catch (error) {
    console.error('Error updating HA config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Delete Home Assistant configuration (admin only)
router.delete('/homeassistant', authenticateToken, async (req, res) => {
  try {
    await db.delete(settings).where(eq(settings.key, 'ha_url'));
    await db.delete(settings).where(eq(settings.key, 'ha_token'));
    await db.delete(settings).where(eq(settings.key, 'ha_tts_service'));
    
    haService.clearCache();
    
    console.log('Home Assistant configuration deleted');
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    console.error('Error deleting HA config:', error);
    res.status(500).json({ error: 'Failed to delete configuration' });
  }
});

// Get Ollama configuration (admin only)
router.get('/ollama', authenticateToken, async (req, res) => {
  try {
    const ollama_enabled = await getSetting('ollama_enabled', 'false');
    const ollama_url = await getSetting('ollama_url', 'http://192.168.5.109:11434');
    const ollama_model = await getSetting('ollama_model', 'llama3.2');

    res.json({
      enabled: ollama_enabled === 'true',
      url: ollama_url,
      model: ollama_model,
    });
  } catch (error) {
    console.error('Error fetching Ollama config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

// Update Ollama configuration (admin only)
router.put('/ollama', authenticateToken, async (req, res) => {
  try {
    const { enabled, url, model } = req.body;

    if (enabled !== undefined) {
      await setSetting('ollama_enabled', enabled ? 'true' : 'false');
    }
    
    if (url !== undefined) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return res.status(400).json({ error: 'URL must start with http:// or https://' });
      }
      await setSetting('ollama_url', url);
    }
    
    if (model !== undefined) {
      if (!model || model.trim() === '') {
        return res.status(400).json({ error: 'Model name cannot be empty' });
      }
      await setSetting('ollama_model', model.trim());
    }

    const ollama_enabled = await getSetting('ollama_enabled', 'false');
    const ollama_url = await getSetting('ollama_url');
    const ollama_model = await getSetting('ollama_model');

    console.log('Ollama configuration updated');

    res.json({
      enabled: ollama_enabled === 'true',
      url: ollama_url,
      model: ollama_model,
    });
  } catch (error) {
    console.error('Error updating Ollama config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Test Ollama connection (admin only)
router.post('/ollama/test', authenticateToken, async (req, res) => {
  try {
    const ollama_url = await getSetting('ollama_url', 'http://192.168.5.109:11434');
    const ollama_model = await getSetting('ollama_model', 'llama3.2');

    // Test with a simple categorization query
    const testQuery = 'Categorize this item into one of these categories: Vegetables, Fruit, Meat, Dairy, Bakery, Pantry Aisles, Household. Item: milk. Respond with just the category name.';

    const response = await axios.post(
      `${ollama_url}/api/generate`,
      {
        model: ollama_model,
        prompt: testQuery,
        stream: false,
      },
      { timeout: 30000 }
    );

    if (response.data && response.data.response) {
      res.json({
        success: true,
        message: 'Ollama connection successful',
        model: ollama_model,
        test_response: response.data.response.trim(),
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Unexpected response from Ollama',
      });
    }
  } catch (error) {
    console.error('Error testing Ollama:', error);
    
    let errorMessage = 'Failed to connect to Ollama';
    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - is Ollama running?';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timed out';
    } else if (error.response?.status === 404) {
      errorMessage = 'Model not found - pull the model first';
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      details: error.message,
    });
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

// Export helper functions for use in other modules
export { getSetting, setSetting };
export default router;
