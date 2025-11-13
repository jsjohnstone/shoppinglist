import { db } from '../db/index.js';
import { ttsPhrases, devices } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { haService } from './homeassistant.js';

// Template variable replacement
function replacePlaceholders(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value);
  }
  return result;
}

// Get TTS phrase by key
async function getTTSPhrase(phraseKey) {
  const [phrase] = await db
    .select()
    .from(ttsPhrases)
    .where(eq(ttsPhrases.phraseKey, phraseKey))
    .limit(1);

  return phrase?.template || null;
}

// Generate and optionally announce TTS message
export async function announceBarcodeResult(deviceId, result) {
  try {
    // Get device info
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, deviceId))
      .limit(1);

    if (!device || !device.isApproved) {
      console.log('Device not found or not approved for TTS');
      return { announced: false, message: null };
    }

    // Determine which phrase to use
    let phraseKey;
    let variables = {};

    if (result.success && result.item) {
      phraseKey = 'success';
      variables = { itemName: result.item.name };
    } else if (!result.success && result.error?.includes('not found')) {
      phraseKey = 'not_found';
    } else {
      phraseKey = 'error';
    }

    // Get phrase template
    const template = await getTTSPhrase(phraseKey);
    
    if (!template) {
      console.error(`TTS phrase not found: ${phraseKey}`);
      return { announced: false, message: null };
    }

    // Generate message
    const message = replacePlaceholders(template, variables);

    // Announce via Home Assistant if device has speaker configured
    if (device.haSpeakerEntity) {
      try {
        await haService.playTTS(device.haSpeakerEntity, message);
        console.log(`TTS announced for device ${deviceId}: ${message}`);
        return { announced: true, message };
      } catch (error) {
        console.error('Failed to announce TTS:', error);
        // Return message anyway even if announcement failed
        return { announced: false, message, error: error.message };
      }
    }

    return { announced: false, message };
  } catch (error) {
    console.error('Error in announceBarcodeResult:', error);
    return { announced: false, message: null, error: error.message };
  }
}

// Get TTS message without announcing (for response)
export async function getTTSMessage(phraseKey, variables = {}) {
  const template = await getTTSPhrase(phraseKey);
  
  if (!template) {
    return null;
  }

  return replacePlaceholders(template, variables);
}
