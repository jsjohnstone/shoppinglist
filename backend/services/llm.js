import { Ollama } from 'ollama';
import { getSetting } from '../routes/settings.js';

// Create Ollama instance dynamically based on settings
async function getOllamaInstance() {
  const enabled = await getSetting('ollama_enabled', 'false');
  if (enabled !== 'true') {
    return null;
  }

  const url = await getSetting('ollama_url', 'http://192.168.5.109:11434');
  return new Ollama({ host: url });
}

async function getModel() {
  return await getSetting('ollama_model', 'llama3.2');
}

// Check if Ollama is enabled
export async function isOllamaEnabled() {
  const enabled = await getSetting('ollama_enabled', 'false');
  return enabled === 'true';
}

/**
 * Process an item name and extract useful information
 * Returns: { name, quantity, notes } or null if Ollama disabled
 */
export async function normalizeItemName(itemName, existingQuantity = null) {
  const ollama = await getOllamaInstance();
  if (!ollama) {
    return null; // Ollama disabled
  }

  try {
    const model = await getModel();
    const prompt = `You are a shopping list assistant. Process this product and extract:
1. Generic item name (remove brands, but keep important descriptors)
2. Quantity (if mentioned and not already specified separately)
3. Important notes (like "boneless", "skinless", "organic", preparation details)

IMPORTANT RULES:
- Remove brand names (Skippy, Heinz, Organic Valley, etc.)
- Keep useful descriptors (boneless, skinless, crunchy, Greek, etc.)
- Extract quantity from the name if present and not specified separately
- Keep preparation/quality info in notes (boneless and skinless, free-range, etc.)

Respond in this EXACT format on separate lines:
NAME: [generic name]
QUANTITY: [quantity or NONE]
NOTES: [important info or NONE]

Examples:
Input: "Skippy Super Chunk Peanut Butter 500g"
NAME: Peanut Butter
QUANTITY: 500g
NOTES: Crunchy

Input: "Organic Valley 2% Milk 1L"
NAME: Milk
QUANTITY: 1L
NOTES: 2% fat

Input: "Butterball Boneless Skinless Chicken Thighs"
NAME: Chicken Thighs
QUANTITY: NONE
NOTES: Boneless and skinless

Input: "Granny Smith Apples"
NAME: Apples
QUANTITY: NONE
NOTES: Granny Smith variety

${existingQuantity ? `Note: Quantity already specified as "${existingQuantity}", so only extract if different or more specific.\n` : ''}
Product: ${itemName}`;

    const response = await ollama.generate({
      model,
      prompt: prompt,
      stream: false,
    });

    const lines = response.response.trim().split('\n');
    let name = itemName;
    let quantity = null;
    let notes = null;

    for (const line of lines) {
      if (line.startsWith('NAME:')) {
        const n = line.substring(5).trim().replace(/^["']|["']$/g, '');
        // FIX: Treat "None", "NONE", "none", etc. as null values
        if (n && n.toUpperCase() !== 'NONE') {
          name = n;
        }
      } else if (line.startsWith('QUANTITY:')) {
        const q = line.substring(9).trim().replace(/^["']|["']$/g, '');
        // FIX: Treat "None", "NONE", "none", etc. as null values
        if (q && q.toUpperCase() !== 'NONE' && !existingQuantity) {
          quantity = q;
        }
      } else if (line.startsWith('NOTES:')) {
        const n = line.substring(6).trim().replace(/^["']|["']$/g, '');
        // FIX: Treat "None", "NONE", "none", etc. as null values
        if (n && n.toUpperCase() !== 'NONE') {
          notes = n;
        }
      }
    }
    
    return {
      name: name || itemName,
      quantity,
      notes
    };
  } catch (error) {
    console.error('Error normalizing item name:', error);
    return {
      name: itemName,
      quantity: null,
      notes: null
    };
  }
}

/**
 * Suggest a category for an item
 * Returns category name that should match one of the existing categories, or null if Ollama disabled
 */
export async function suggestCategory(itemName) {
  const ollama = await getOllamaInstance();
  if (!ollama) {
    return null; // Ollama disabled
  }

  try {
    const model = await getModel();
    const prompt = `You are a grocery categorization assistant. Given an item name, return ONLY ONE category name from this list:
- Vegetables
- Fruit
- Meat
- Dairy
- Bakery
- Pantry Aisles
- Household

Be concise - return ONLY the category name, nothing else.

Item: ${itemName}
Category:`;

    const response = await ollama.generate({
      model,
      prompt: prompt,
      stream: false,
    });

    const category = response.response.trim()
      .replace(/^["']|["']$/g, '') // Remove quotes
      .split('\n')[0]; // Take first line only
    
    return category || null;
  } catch (error) {
    console.error('Error suggesting category:', error);
    return null;
  }
}

/**
 * Process an item: normalize name, extract info, and suggest category
 * Returns null if Ollama is disabled
 */
export async function processItem(itemName, existingQuantity = null, existingNotes = null) {
  const enabled = await isOllamaEnabled();
  if (!enabled) {
    return null;
  }

  const [normalized, suggestedCategory] = await Promise.all([
    normalizeItemName(itemName, existingQuantity),
    suggestCategory(itemName)
  ]);

  // If normalization failed, return null
  if (!normalized) {
    return null;
  }

  return {
    name: normalized.name,
    quantity: normalized.quantity || existingQuantity,
    notes: existingNotes ? 
      (normalized.notes ? `${existingNotes}. ${normalized.notes}` : existingNotes) :
      normalized.notes,
    suggestedCategory
  };
}
