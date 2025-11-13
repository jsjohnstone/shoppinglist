import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { haService } from '../services/homeassistant.js';

const router = express.Router();

// Test Home Assistant connection (admin only)
router.post('/test', authenticateToken, async (req, res) => {
  try {
    const result = await haService.testConnection();
    res.json(result);
  } catch (error) {
    console.error('HA test error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get media player entities (admin only)
router.get('/entities', authenticateToken, async (req, res) => {
  try {
    const entities = await haService.getMediaPlayerEntities();
    res.json(entities);
  } catch (error) {
    console.error('Error fetching entities:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all states (admin only)
router.get('/states', authenticateToken, async (req, res) => {
  try {
    const states = await haService.getStates();
    res.json(states);
  } catch (error) {
    console.error('Error fetching states:', error);
    res.status(500).json({ error: error.message });
  }
});

// Play TTS message (device auth)
router.post('/tts', authenticateDevice, async (req, res) => {
  try {
    const { message, entity_id, service } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'message is required' });
    }

    // Use device's configured speaker or provided entity_id
    const targetEntity = entity_id || req.device.haSpeakerEntity;

    if (!targetEntity) {
      return res.status(400).json({ 
        error: 'No speaker entity configured for this device' 
      });
    }

    await haService.playTTS(targetEntity, message, service);

    res.json({ success: true });
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Play sound file (device auth)
router.post('/play_sound', authenticateDevice, async (req, res) => {
  try {
    const { sound_url, entity_id } = req.body;

    if (!sound_url) {
      return res.status(400).json({ error: 'sound_url is required' });
    }

    const targetEntity = entity_id || req.device.haSpeakerEntity;

    if (!targetEntity) {
      return res.status(400).json({ 
        error: 'No speaker entity configured for this device' 
      });
    }

    await haService.playSound(targetEntity, sound_url);

    res.json({ success: true });
  } catch (error) {
    console.error('Sound playback error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
