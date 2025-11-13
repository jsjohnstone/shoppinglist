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
    const prompt = `You are a shopping list assistant. Process this grocery item and extract:
1. Generic item name (remove brands, bullets, numbers, but keep essential product type)
2. Quantity (if mentioned in the text)
3. Notes (ONLY essential product characteristics - variety, preparation type, or specific requirements)

CRITICAL RULES FOR NOTES:
- ONLY include notes for essential product characteristics (variety, preparation type, cut, fat content)
- DO NOT add descriptions, opinions, marketing language, or recipes
- DO NOT add subjective comments (delicious, healthy, tasty, etc.)
- DO NOT add usage suggestions or preparation ideas
- MOST items should have NOTES: NONE - only add notes when truly necessary
- Keep notes to 2-3 words maximum
- Notes are for product specifications, NOT commentary

Examples of GOOD notes:
- "Boneless", "Skinless", "Self-raising", "Greek style", "Crunchy", "Extra virgin"
- "Free-range", "Organic", "Low-fat", "Wholemeal", "Granny Smith variety"

Examples of BAD notes (NEVER do this):
- "Delicious and healthy" ❌
- "Perfect for recipes" ❌  
- "Nutritious option" ❌
- "Great for cooking" ❌

Respond in this EXACT format on separate lines:
NAME: [generic name]
QUANTITY: [quantity or NONE]
NOTES: [brief characteristic or NONE]

Examples:
Input: "Skippy Super Chunk Peanut Butter 500g"
NAME: Peanut Butter
QUANTITY: 500g
NOTES: Crunchy

Input: "2L Milk"
NAME: Milk
QUANTITY: 2L
NOTES: NONE

Input: "Dog Food"
NAME: Dog Food
QUANTITY: NONE
NOTES: NONE

Input: "500g self-raising flour"
NAME: Flour
QUANTITY: 500g
NOTES: Self-raising

Input: "Organic Free-Range Eggs"
NAME: Eggs
QUANTITY: NONE
NOTES: Organic, free-range

Input: "- 3 Eggs"
NAME: Eggs
QUANTITY: 3
NOTES: NONE

Input: "Greek Yogurt"
NAME: Yogurt
QUANTITY: NONE
NOTES: Greek style

Input: "Cat Food"
NAME: Cat Food
QUANTITY: NONE
NOTES: NONE

Input: "Chicken Breast"
NAME: Chicken Breast
QUANTITY: NONE
NOTES: NONE

Input: "Boneless Skinless Chicken Thighs"
NAME: Chicken Thighs
QUANTITY: NONE
NOTES: Boneless, skinless

Input: "1. Granny Smith Apples"
NAME: Apples
QUANTITY: NONE
NOTES: Granny Smith

Input: "Bread"
NAME: Bread
QUANTITY: NONE
NOTES: NONE

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
