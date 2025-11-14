import { Ollama } from 'ollama';
import { getSetting } from '../routes/settings.js';
import logger from '../logger.js';
import { db } from '../db/index.js';
import { categories } from '../db/schema.js';

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
  const startTime = Date.now();
  
  const ollama = await getOllamaInstance();
  if (!ollama) {
    logger.debug('LLM normalization skipped (disabled)', { itemName });
    return null; // Ollama disabled
  }

  logger.debug('LLM normalization started', { itemName, existingQuantity });

  try {
    const model = await getModel();
    const prompt = `You are a shopping list assistant. Process this grocery item and extract:
1. Item name (apply smart brand handling - see rules below)
2. Quantity (ONLY if EXPLICITLY mentioned in the text - DO NOT INFER OR GUESS)
3. Notes (ONLY essential product characteristics - variety, preparation type, or specific requirements)

⚠️ CRITICAL RULES FOR BRAND NAMES:
- For GENERIC/COMMODITY items (meat, produce, spices, dairy, flour, etc.), REMOVE the brand name
  Examples: "Halalfoods Chicken Thighs" → "Chicken Thighs", "M&S Ground Coriander" → "Ground Coriander"
- For BRANDED PACKAGED GOODS where the brand IS the product identity, KEEP the brand name
  Examples: "Coca Cola" → "Coca Cola", "Pringles Paprika" → "Pringles", "Twix 2 pack" → "Twix"
- Branded products include: sodas, chips/crisps, chocolate bars, cereals, cookies, instant meals, etc.
- When in doubt: ask yourself "would a different brand be a completely different product?" If yes, keep the brand

⚠️ CRITICAL RULES FOR QUANTITY:
- ONLY extract quantity if it is EXPLICITLY written in the input text
- DO NOT infer, assume, or guess quantities based on typical sizes
- "milk" = QUANTITY: NONE (no quantity mentioned)
- "2L milk" = QUANTITY: 2L (quantity explicitly stated)
- "bread" = QUANTITY: NONE (no quantity mentioned)
- "3 eggs" = QUANTITY: 3 (quantity explicitly stated)
- If you cannot find a number or amount in the actual input text, ALWAYS use NONE
- DO NOT use your knowledge of typical product sizes to add quantities

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

⚠️ COMPLETE EXAMPLES - READ CAREFULLY:

BRAND NAME HANDLING EXAMPLES:
Input: "2kg Halalfoods Chicken Thighs, Skinless and Boneless"
NAME: Chicken Thighs
QUANTITY: 2kg
NOTES: Skinless, boneless

Input: "M&S Ground Coriander"
NAME: Ground Coriander
QUANTITY: NONE
NOTES: NONE

Input: "Coca Cola"
NAME: Coca Cola
QUANTITY: NONE
NOTES: NONE

Input: "Pringles Paprika"
NAME: Pringles
QUANTITY: NONE
NOTES: Paprika

Input: "Twix 2 pack"
NAME: Twix
QUANTITY: 2 pack
NOTES: NONE

Input: "Tesco Finest Salmon Fillet 400g"
NAME: Salmon Fillet
QUANTITY: 400g
NOTES: NONE

Input: "Heinz Baked Beans"
NAME: Heinz Baked Beans
QUANTITY: NONE
NOTES: NONE

Input: "Kellogg's Corn Flakes"
NAME: Kellogg's Corn Flakes
QUANTITY: NONE
NOTES: NONE

QUANTITY EXAMPLES:
Input: "Skippy Super Chunk Peanut Butter 500g"
NAME: Peanut Butter
QUANTITY: 500g
NOTES: Crunchy

Input: "2L Milk"
NAME: Milk
QUANTITY: 2L
NOTES: NONE

Input: "milk" (NO quantity in text!)
NAME: Milk
QUANTITY: NONE
NOTES: NONE

Input: "bread" (NO quantity in text!)
NAME: Bread
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

Input: "Boneless Skinless Chicken Thighs"
NAME: Chicken Thighs
QUANTITY: NONE
NOTES: Boneless, skinless

${existingQuantity ? `Note: Quantity already specified as "${existingQuantity}", so only extract if different or more specific.\n` : ''}
Product: ${itemName}`;

    logger.debug('Sending to LLM', { itemName, model });
    
    const response = await ollama.generate({
      model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for more deterministic, conservative responses
      },
    });
    
    const duration = Date.now() - startTime;

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
    
    const result = {
      name: name || itemName,
      quantity,
      notes
    };
    
    logger.info('LLM normalization completed', {
      itemName,
      duration: `${duration}ms`,
      result
    });
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('LLM normalization failed', {
      itemName,
      duration: `${duration}ms`,
      error: error.message
    });
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
  const startTime = Date.now();
  
  const ollama = await getOllamaInstance();
  if (!ollama) {
    logger.debug('LLM category suggestion skipped (disabled)', { itemName });
    return null; // Ollama disabled
  }

  logger.debug('LLM category suggestion started', { itemName });

  try {
    // Fetch categories from database
    const allCategories = await db.select({ name: categories.name }).from(categories);
    
    if (allCategories.length === 0) {
      logger.warn('No categories found in database', { itemName });
      return null;
    }

    // Build category list for prompt
    const categoryList = allCategories.map(c => `- ${c.name}`).join('\n');

    const model = await getModel();
    const prompt = `You are a grocery categorization assistant. Given an item name, return ONLY ONE category name from this list:
${categoryList}

Be concise - return ONLY the category name, nothing else.

Item: ${itemName}
Category:`;

    const response = await ollama.generate({
      model,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.1, // Low temperature for more deterministic responses
      },
    });

    const duration = Date.now() - startTime;
    const category = response.response.trim()
      .replace(/^["']|["']$/g, '') // Remove quotes
      .split('\n')[0]; // Take first line only
    
    logger.info('LLM category suggestion completed', {
      itemName,
      duration: `${duration}ms`,
      category
    });
    
    return category || null;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('LLM category suggestion failed', {
      itemName,
      duration: `${duration}ms`,
      error: error.message
    });
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

  const result = {
    name: normalized.name,
    quantity: normalized.quantity || existingQuantity,
    notes: existingNotes ? 
      (normalized.notes ? `${existingNotes}. ${normalized.notes}` : existingNotes) :
      normalized.notes,
    suggestedCategory
  };
  
  logger.info('LLM item processing completed', {
    itemName,
    result
  });
  
  return result;
}
