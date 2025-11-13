import express from 'express';
import { db } from '../db/index.js';
import { items, categories } from '../db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateApiKey } from '../middleware/apiKey.js';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { processItem } from '../services/llm.js';
import { processBarcode, isBarcode } from '../services/barcode.js';

const router = express.Router();

// Helper function to find or create category
async function findOrCreateCategory(categoryName) {
  if (!categoryName) return null;

  // Try to find existing category (case-insensitive)
  const [category] = await db.select()
    .from(categories)
    .where(eq(categories.name, categoryName))
    .limit(1);

  if (category) {
    return category.id;
  }

  // Create new category
  const [newCategory] = await db.insert(categories)
    .values({ name: categoryName })
    .returning({ id: categories.id });

  return newCategory.id;
}

// Get all items (supports filtering)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, relatedTo } = req.query;

    let query = db.select({
      id: items.id,
      name: items.name,
      quantity: items.quantity,
      notes: items.notes,
      relatedTo: items.relatedTo,
      categoryId: items.categoryId,
      categoryName: categories.name,
      isCompleted: items.isCompleted,
      isProcessing: items.isProcessing,
      barcode: items.barcode,
      wasScanned: items.wasScanned,
      completedAt: items.completedAt,
      sortOrder: items.sortOrder,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .orderBy(items.isCompleted, items.sortOrder, desc(items.createdAt));

    // Filter by completion status
    if (status === 'active') {
      query = query.where(eq(items.isCompleted, false));
    } else if (status === 'completed') {
      query = query.where(eq(items.isCompleted, true));
    }

    // Filter by relatedTo
    if (relatedTo) {
      query = query.where(eq(items.relatedTo, relatedTo));
    }

    const allItems = await query;

    res.json(allItems);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Add new item (with async LLM processing or barcode processing)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, quantity, notes, relatedTo, category, skipLlm } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Item name is required' });
    }

    // Check if this is a barcode
    const isBarcodeInput = isBarcode(name);

    // First, add the item immediately with processing flag
    const [newItem] = await db.insert(items)
      .values({
        name: name,
        quantity: quantity || null,
        notes: notes || null,
        relatedTo: relatedTo || null,
        categoryId: category ? await findOrCreateCategory(category) : null,
        isProcessing: isBarcodeInput || !skipLlm ? true : false,
        barcode: isBarcodeInput ? name.trim() : null,
        wasScanned: isBarcodeInput,
        addedBy: req.user.id,
      })
      .returning();

    // Fetch with category name for immediate response
    const [itemWithCategory] = await db.select({
      id: items.id,
      name: items.name,
      quantity: items.quantity,
      notes: items.notes,
      relatedTo: items.relatedTo,
      categoryId: items.categoryId,
      categoryName: categories.name,
      isCompleted: items.isCompleted,
      isProcessing: items.isProcessing,
      barcode: items.barcode,
      wasScanned: items.wasScanned,
      completedAt: items.completedAt,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(items.id, newItem.id))
    .limit(1);

    // Return immediately with processing state
    res.status(201).json(itemWithCategory);

    // Process asynchronously
    if (isBarcodeInput) {
      processBarcodeAsync(newItem.id, name.trim(), quantity, notes, relatedTo, category);
    } else if (!skipLlm) {
      processItemAsync(newItem.id, name, quantity, notes, category);
    }
  } catch (error) {
    console.error('Error adding item:', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Async function to process barcode
async function processBarcodeAsync(itemId, barcode, existingQuantity, existingNotes, relatedTo, providedCategory) {
  try {
    // Import at function level to avoid circular dependencies
    const { fetchProduct } = await import('../services/openfoodfacts.js');
    const { barcodes: barcodesTable, pendingBarcodes: pendingBarcodesTable } = await import('../db/schema.js');

    // Check if barcode exists in cache
    const [cachedBarcode] = await db
      .select()
      .from(barcodesTable)
      .where(eq(barcodesTable.barcode, barcode))
      .limit(1);

    let genericName, categoryId;

    if (cachedBarcode) {
      console.log(`Using cached barcode data for ${barcode}`);
      genericName = cachedBarcode.genericName;
      
      // FIX: Respect user's category choice from form if provided
      if (providedCategory) {
        categoryId = await findOrCreateCategory(providedCategory);
      } else {
        categoryId = cachedBarcode.categoryId;
      }

      // Update last used
      await db
        .update(barcodesTable)
        .set({ lastUsed: new Date() })
        .where(eq(barcodesTable.barcode, barcode));
    } else {
      // Add to pending
      await db.insert(pendingBarcodesTable).values({
        barcode,
        rawData: null,
      });

      // Fetch from OpenFoodFacts
      const productData = await fetchProduct(barcode);

      if (!productData.found) {
        // Update with error info
        await db
          .update(pendingBarcodesTable)
          .set({ rawData: JSON.stringify({ error: productData.error }) })
          .where(eq(pendingBarcodesTable.barcode, barcode));

        // Update item with error
        await db.update(items)
          .set({
            name: `Barcode: ${barcode}`,
            notes: existingNotes ? `${existingNotes}. Error: ${productData.error}` : `Error: ${productData.error}`,
            isProcessing: false,
            updatedAt: new Date(),
          })
          .where(eq(items.id, itemId));

        // Clean up pending
        await db.delete(pendingBarcodesTable).where(eq(pendingBarcodesTable.barcode, barcode));
        return;
      }

      // Store raw data
      await db
        .update(pendingBarcodesTable)
        .set({ rawData: JSON.stringify(productData) })
        .where(eq(pendingBarcodesTable.barcode, barcode));

      // Process through LLM
      const fullName = `${productData.brand} ${productData.productName}`.trim();
      const llmResult = await processItem(fullName, existingQuantity, existingNotes);

      // Find category
      const allCategories = await db.select().from(categories);
      const matchedCategory = allCategories.find(
        cat => cat.name.toLowerCase() === llmResult.suggestedCategory.toLowerCase()
      );
      categoryId = matchedCategory?.id || null;

      // Store in barcodes table
      await db.insert(barcodesTable).values({
        barcode,
        fullProductName: productData.fullProductName,
        genericName: llmResult.name,
        categoryId,
        source: 'openfoodfacts',
      });

      genericName = llmResult.name;

      // Clean up pending
      await db.delete(pendingBarcodesTable).where(eq(pendingBarcodesTable.barcode, barcode));
    }

    // Update the item with processed data
    await db.update(items)
      .set({
        name: genericName,
        categoryId,
        isProcessing: false,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));

    console.log(`Barcode ${itemId} processed: ${barcode} -> ${genericName}`);
  } catch (error) {
    console.error(`Error processing barcode ${itemId}:`, error);
    // Mark as not processing even if failed
    await db.update(items)
      .set({
        isProcessing: false,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }
}

// Async function to process item with LLM
async function processItemAsync(itemId, originalName, existingQuantity, existingNotes, providedCategory) {
  try {
    const processed = await processItem(originalName, existingQuantity, existingNotes);
    
    // Use provided category if given, otherwise use LLM suggestion
    const categoryToUse = providedCategory || processed.suggestedCategory;
    const categoryId = await findOrCreateCategory(categoryToUse);

    // Update the item with processed data
    await db.update(items)
      .set({
        name: processed.name,
        quantity: processed.quantity,
        notes: processed.notes,
        categoryId,
        isProcessing: false,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));

    console.log(`Item ${itemId} processed: ${originalName} -> ${processed.name}`);
  } catch (error) {
    console.error(`Error processing item ${itemId}:`, error);
    // Mark as not processing even if failed
    await db.update(items)
      .set({
        isProcessing: false,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }
}

// Add item via barcode (for barcode scanner devices)
router.post('/barcode', authenticateDevice, async (req, res) => {
  try {
    const { barcode, quantity, notes, relatedTo, device_id } = req.body;

    if (!barcode) {
      return res.status(400).json({ error: 'Barcode is required' });
    }

    // Process barcode (waits for complete resolution)
    const result = await processBarcode(
      barcode,
      null, // No user ID for API key auth
      quantity || null,
      notes || null,
      relatedTo || null
    );

    // Fetch with category name for complete response
    let itemWithCategory = null;
    if (result.item) {
      [itemWithCategory] = await db.select({
        id: items.id,
        name: items.name,
        quantity: items.quantity,
        notes: items.notes,
        relatedTo: items.relatedTo,
        categoryId: items.categoryId,
        categoryName: categories.name,
        isCompleted: items.isCompleted,
        isProcessing: items.isProcessing,
        barcode: items.barcode,
        wasScanned: items.wasScanned,
        completedAt: items.completedAt,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .leftJoin(categories, eq(items.categoryId, categories.id))
      .where(eq(items.id, result.item.id))
      .limit(1);
    }

    // Announce via TTS if device_id provided
    let ttsResult = { announced: false, message: null };
    if (device_id) {
      const { announceBarcodeResult } = await import('../services/tts.js');
      ttsResult = await announceBarcodeResult(device_id, {
        success: result.success,
        item: itemWithCategory,
        error: result.error,
      });
    }

    // Return appropriate response
    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: result.error,
        item: itemWithCategory,
        tts_message: ttsResult.message,
        tts_announced: ttsResult.announced,
      });
    }

    res.status(201).json({
      success: true,
      item: itemWithCategory,
      fullProductName: result.fullProductName,
      tts_message: ttsResult.message,
      tts_announced: ttsResult.announced,
    });
  } catch (error) {
    console.error('Error processing barcode:', error);
    res.status(500).json({ error: 'Failed to process barcode' });
  }
});

// Add item via API key (for external apps like barcode scanner)
router.post('/api-add', authenticateApiKey, async (req, res) => {
  try {
    const { name, quantity, notes, relatedTo, category } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Item name is required' });
    }

    let finalName = name;
    let categoryId = null;

    // Process with LLM
    try {
      const { normalizedName, suggestedCategory } = await processItem(name);
      finalName = normalizedName;
      const categoryToUse = category || suggestedCategory;
      categoryId = await findOrCreateCategory(categoryToUse);
    } catch (llmError) {
      console.error('LLM processing failed:', llmError);
      if (category) {
        categoryId = await findOrCreateCategory(category);
      }
    }

    const [newItem] = await db.insert(items)
      .values({
        name: finalName,
        quantity: quantity || null,
        notes: notes || null,
        relatedTo: relatedTo || null,
        categoryId,
        addedBy: null, // External API, no user
      })
      .returning();

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error adding item via API:', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// Update item
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, quantity, notes, relatedTo, category } = req.body;

    // Get current item to check if it's a barcode item
    const [currentItem] = await db.select()
      .from(items)
      .where(eq(items.id, parseInt(id)))
      .limit(1);

    if (!currentItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const updateData = {
      updatedAt: new Date(),
    };

    if (name !== undefined) updateData.name = name;
    if (quantity !== undefined) updateData.quantity = quantity || null;
    if (notes !== undefined) updateData.notes = notes || null;
    if (relatedTo !== undefined) updateData.relatedTo = relatedTo || null;
    
    let newCategoryId = null;
    if (category !== undefined) {
      newCategoryId = await findOrCreateCategory(category);
      updateData.categoryId = newCategoryId;
    }

    const [updatedItem] = await db.update(items)
      .set(updateData)
      .where(eq(items.id, parseInt(id)))
      .returning();

    // FIX: If this is a barcode item and category was changed, update the barcode cache
    if (currentItem.barcode && category !== undefined && newCategoryId !== currentItem.categoryId) {
      const { barcodes: barcodesTable } = await import('../db/schema.js');
      await db.update(barcodesTable)
        .set({ categoryId: newCategoryId })
        .where(eq(barcodesTable.barcode, currentItem.barcode))
        .catch(err => {
          console.error('Error updating barcode cache:', err);
          // Don't fail the request if barcode update fails
        });
      console.log(`Updated barcode cache for ${currentItem.barcode} with new category`);
    }

    // Fetch with category name
    const [itemWithCategory] = await db.select({
      id: items.id,
      name: items.name,
      quantity: items.quantity,
      notes: items.notes,
      relatedTo: items.relatedTo,
      categoryId: items.categoryId,
      categoryName: categories.name,
      isCompleted: items.isCompleted,
      barcode: items.barcode,
      wasScanned: items.wasScanned,
      completedAt: items.completedAt,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(items.id, parseInt(id)))
    .limit(1);

    res.json(itemWithCategory);
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// Toggle item completion status
router.patch('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get current item
    const [currentItem] = await db.select()
      .from(items)
      .where(eq(items.id, parseInt(id)))
      .limit(1);

    if (!currentItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Toggle completion
    const newStatus = !currentItem.isCompleted;
    const [updatedItem] = await db.update(items)
      .set({
        isCompleted: newStatus,
        completedAt: newStatus ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(items.id, parseInt(id)))
      .returning();

    res.json(updatedItem);
  } catch (error) {
    console.error('Error toggling item completion:', error);
    res.status(500).json({ error: 'Failed to toggle completion' });
  }
});

// Delete item
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [deletedItem] = await db.delete(items)
      .where(eq(items.id, parseInt(id)))
      .returning();

    if (!deletedItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json({ message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Reorder items
router.post('/reorder', authenticateToken, async (req, res) => {
  try {
    const { itemOrders } = req.body; // Array of { id, sortOrder }

    if (!Array.isArray(itemOrders)) {
      return res.status(400).json({ error: 'itemOrders must be an array' });
    }

    // Update each item's sort order
    await Promise.all(
      itemOrders.map(({ id, sortOrder }) =>
        db.update(items)
          .set({ sortOrder, updatedAt: new Date() })
          .where(eq(items.id, parseInt(id)))
      )
    );

    res.json({ message: 'Items reordered successfully' });
  } catch (error) {
    console.error('Error reordering items:', error);
    res.status(500).json({ error: 'Failed to reorder items' });
  }
});

export default router;
