import { db } from '../db/index.js';
import { barcodes, pendingBarcodes, categories, items } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { fetchProduct } from './openfoodfacts.js';
import { processItem } from './llm.js';

/**
 * Process a barcode and create an item
 * @param {string} barcode - The barcode to process
 * @param {number} userId - The user ID adding the item
 * @param {string|null} quantity - Optional quantity override
 * @param {string|null} notes - Optional notes override
 * @param {string|null} relatedTo - Optional related item
 * @returns {Promise<Object>} The created item or error
 */
export async function processBarcode(barcode, userId, quantity = null, notes = null, relatedTo = null) {
  try {
    // Step 1: Check if barcode exists in cache
    const [cachedBarcode] = await db
      .select()
      .from(barcodes)
      .where(eq(barcodes.barcode, barcode))
      .limit(1);

    let genericName, categoryId, fullProductName;

    if (cachedBarcode) {
      // Use cached data
      console.log(`Using cached barcode data for ${barcode}`);
      genericName = cachedBarcode.genericName;
      categoryId = cachedBarcode.categoryId;
      fullProductName = cachedBarcode.fullProductName;

      // Update last used timestamp
      await db
        .update(barcodes)
        .set({ lastUsed: new Date() })
        .where(eq(barcodes.barcode, barcode));
    } else {
      // Step 2: Add to pending_barcodes
      console.log(`Processing new barcode: ${barcode}`);
      await db.insert(pendingBarcodes).values({
        barcode,
        rawData: null,
      });

      // Step 3: Fetch from OpenFoodFacts
      const productData = await fetchProduct(barcode);

      if (!productData.found) {
        // Store failed lookup with error
        await db
          .update(pendingBarcodes)
          .set({ rawData: JSON.stringify({ error: productData.error }) })
          .where(eq(pendingBarcodes.barcode, barcode));

        // Create item with barcode as name (user can edit later)
        const [newItem] = await db
          .insert(items)
          .values({
            name: `Barcode: ${barcode}`,
            quantity,
            notes: notes ? `${notes}. Error: ${productData.error}` : `Error: ${productData.error}`,
            relatedTo,
            addedBy: userId,
            barcode,
            wasScanned: true,
            isProcessing: false,
          })
          .returning();

        // Remove from pending
        await db.delete(pendingBarcodes).where(eq(pendingBarcodes.barcode, barcode));

        return {
          success: false,
          item: newItem,
          error: productData.error,
        };
      }

      // Step 4: Store raw data in pending
      await db
        .update(pendingBarcodes)
        .set({ rawData: JSON.stringify(productData) })
        .where(eq(pendingBarcodes.barcode, barcode));

      // Step 5: Process through LLM
      const fullName = `${productData.brand} ${productData.productName}`.trim();
      const llmResult = await processItem(fullName, quantity, notes);

      // Step 6: Find matching category
      const allCategories = await db.select().from(categories);
      const matchedCategory = allCategories.find(
        cat => cat.name.toLowerCase() === llmResult.suggestedCategory.toLowerCase()
      );
      categoryId = matchedCategory?.id || null;

      // Step 7: Store in barcodes table
      await db.insert(barcodes).values({
        barcode,
        fullProductName: productData.fullProductName,
        genericName: llmResult.name,
        categoryId,
        source: 'openfoodfacts',
      });

      genericName = llmResult.name;
      fullProductName = productData.fullProductName;

      // Remove from pending
      await db.delete(pendingBarcodes).where(eq(pendingBarcodes.barcode, barcode));
    }

    // Step 8: Create the item
    const [newItem] = await db
      .insert(items)
      .values({
        name: genericName,
        quantity,
        notes,
        relatedTo,
        categoryId,
        addedBy: userId,
        barcode,
        wasScanned: true,
        isProcessing: false,
      })
      .returning();

    return {
      success: true,
      item: newItem,
      fullProductName,
    };
  } catch (error) {
    console.error('Error processing barcode:', error);
    
    // Try to clean up pending barcode
    try {
      await db.delete(pendingBarcodes).where(eq(pendingBarcodes.barcode, barcode));
    } catch (cleanupError) {
      console.error('Error cleaning up pending barcode:', cleanupError);
    }

    throw error;
  }
}

/**
 * Check if a string looks like a barcode (8-13 digits)
 * @param {string} input - The input string to check
 * @returns {boolean} Whether it looks like a barcode
 */
export function isBarcode(input) {
  if (!input || typeof input !== 'string') return false;
  
  // Remove whitespace
  const cleaned = input.trim();
  
  // Check if it's 8, 12, or 13 digits (common barcode formats)
  return /^\d{8}$|^\d{12}$|^\d{13}$/.test(cleaned);
}
