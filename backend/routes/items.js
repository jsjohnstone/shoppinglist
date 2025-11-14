import express from 'express';
import { db } from '../db/index.js';
import { items, categories } from '../db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateApiKey } from '../middleware/apiKey.js';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { processItem, isOllamaEnabled } from '../services/llm.js';
import { processBarcode, isBarcode } from '../services/barcode.js';
import { logDeviceEvent } from '../services/deviceEvents.js';
import logger from '../logger.js';

const router = express.Router();

// SSE connections store
const sseClients = new Set();

// Helper to broadcast to all clients of a specific user
function broadcastToUser(userId, event) {
  sseClients.forEach(client => {
    if (client.userId === userId) {
      try {
        client.res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch (error) {
        console.error('Error broadcasting to client:', error);
        sseClients.delete(client);
      }
    }
  });
}

// Helper to broadcast to ALL connected clients (for device/API additions)
function broadcastToAll(event) {
  sseClients.forEach(client => {
    try {
      client.res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      console.error('Error broadcasting to client:', error);
      sseClients.delete(client);
    }
  });
}

  // SSE endpoint for real-time updates
  // Supports both header auth (JWT in Authorization header) and query param auth (for EventSource)
  router.get('/events', async (req, res) => {
    // EventSource doesn't support custom headers, so we accept token via query param
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      logger.warn('SSE connection rejected - no token');
      return res.status(401).json({ error: 'No authentication token provided' });
    }

    // Verify token
    let user;
    try {
      const jwt = await import('jsonwebtoken');
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      user = decoded;
    } catch (error) {
      logger.warn('SSE connection rejected - invalid token');
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable nginx buffering
  });

    // Add client to set
    const clientId = Date.now();
    const client = { id: clientId, userId: user.id, res };
    sseClients.add(client);

    logger.info('SSE client connected', {
      clientId,
      userId: user.id
    });

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (error) {
      clearInterval(heartbeat);
      sseClients.delete(client);
    }
  }, 30000);

    // Clean up on disconnect
    req.on('close', () => {
      logger.info('SSE client disconnected', { clientId });
      clearInterval(heartbeat);
      sseClients.delete(client);
    });
  });

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
      categoryIcon: categories.icon,
      categoryColor: categories.color,
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

  // Bulk add items (with async LLM processing for each item)
  router.post('/bulk-add', authenticateToken, async (req, res) => {
    try {
      const { items: itemTexts, relatedTo, categoryId } = req.body;

      logger.info('Bulk add items request', {
        userId: req.user.id,
        itemCount: itemTexts?.length || 0
      });

      // Validation
      if (!Array.isArray(itemTexts) || itemTexts.length === 0) {
        return res.status(400).json({ error: 'Items array is required and must not be empty' });
      }

      if (itemTexts.length > 50) {
        return res.status(400).json({ error: 'Maximum 50 items allowed per batch' });
      }

    // Validate all items are non-empty strings
    const validItemTexts = itemTexts.filter(text => 
      typeof text === 'string' && text.trim().length > 0
    );

    if (validItemTexts.length === 0) {
      return res.status(400).json({ error: 'No valid items to add' });
    }

    // Check if Ollama is enabled
    const ollamaEnabled = await isOllamaEnabled();

    // Create all items immediately with processing flag
    const createdItems = [];
    for (const itemText of validItemTexts) {
      const [newItem] = await db.insert(items)
        .values({
          name: itemText.trim(),
          quantity: null,
          notes: null,
          relatedTo: relatedTo || null,
          categoryId: categoryId || null,
          isProcessing: ollamaEnabled,
          addedBy: req.user.id,
        })
        .returning();
      
      createdItems.push(newItem);
    }

    // Fetch all created items with category names
    const itemsWithCategories = await Promise.all(
      createdItems.map(async (item) => {
        const [itemWithCategory] = await db.select({
          id: items.id,
          name: items.name,
          quantity: items.quantity,
          notes: items.notes,
          relatedTo: items.relatedTo,
          categoryId: items.categoryId,
          categoryName: categories.name,
          categoryIcon: categories.icon,
          categoryColor: categories.color,
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
        .where(eq(items.id, item.id))
        .limit(1);
        
        return itemWithCategory;
      })
    );

    logger.info('Bulk add completed', {
      userId: req.user.id,
      itemsAdded: createdItems.length,
      processingEnabled: ollamaEnabled
    });

    // Return immediately with processing state
    res.status(201).json({
      success: true,
      itemsAdded: createdItems.length,
      items: itemsWithCategories,
    });

    // Process each item asynchronously if Ollama is enabled
    if (ollamaEnabled) {
      for (const item of createdItems) {
        processItemAsync(item.id, item.name, null, null, null);
      }
    }
  } catch (error) {
    logger.error('Error bulk adding items', {
      userId: req.user.id,
      error: error.message
    });
    res.status(500).json({ error: 'Failed to bulk add items' });
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
      
      logger.info('Adding item', {
        userId: req.user.id,
        itemName: name,
        isBarcode: isBarcodeInput,
        category
      });

    // Check if Ollama is enabled
    const ollamaEnabled = await isOllamaEnabled();
    const shouldProcess = ollamaEnabled && (isBarcodeInput || !skipLlm);

    // First, add the item immediately with processing flag
    const [newItem] = await db.insert(items)
      .values({
        name: name,
        quantity: quantity || null,
        notes: notes || null,
        relatedTo: relatedTo || null,
        categoryId: category ? await findOrCreateCategory(category) : null,
        isProcessing: shouldProcess,
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
      categoryIcon: categories.icon,
      categoryColor: categories.color,
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

    logger.info('Item added', {
      userId: req.user.id,
      itemId: newItem.id,
      itemName: itemWithCategory.name,
      willProcess: shouldProcess
    });

    // Return immediately with processing state
    res.status(201).json(itemWithCategory);

    // Broadcast to all users
    if (req.user?.id) {
      broadcastToUser(req.user.id, {
        type: 'item_added',
        item: itemWithCategory,
      });
    }

    // Process asynchronously only if Ollama is enabled
    if (shouldProcess) {
      if (isBarcodeInput) {
        processBarcodeAsync(newItem.id, name.trim(), quantity, notes, relatedTo, category);
      } else if (!skipLlm) {
        processItemAsync(newItem.id, name, quantity, notes, category);
      }
    }
  } catch (error) {
    logger.error('Error adding item', {
      userId: req.user.id,
      error: error.message
    });
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

      // Process through LLM if enabled
      const fullName = `${productData.brand} ${productData.productName}`.trim();
      const llmResult = await processItem(fullName, existingQuantity, existingNotes);

      if (llmResult) {
        // Ollama enabled - use LLM result
        const allCategories = await db.select().from(categories);
        const matchedCategory = allCategories.find(
          cat => cat.name.toLowerCase() === (llmResult.suggestedCategory || '').toLowerCase()
        );
        categoryId = matchedCategory?.id || null;
        genericName = llmResult.name;
      } else {
        // Ollama disabled - use OpenFoodFacts name directly
        genericName = productData.productName;
        categoryId = null;
      }

      // Store in barcodes table
      await db.insert(barcodesTable).values({
        barcode,
        fullProductName: productData.fullProductName,
        genericName,
        categoryId,
        source: 'openfoodfacts',
      });

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
    
    if (!processed) {
      // Ollama disabled - just mark as not processing
      await db.update(items)
        .set({
          isProcessing: false,
          updatedAt: new Date(),
        })
        .where(eq(items.id, itemId));
      return;
    }

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

    logger.debug('Item async processing completed', {
      itemId,
      originalName,
      processedName: processed.name
    });
  } catch (error) {
    logger.error('Error processing item async', {
      itemId,
      error: error.message
    });
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
        categoryIcon: categories.icon,
        categoryColor: categories.color,
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

    // Log device event
    if (req.device?.id) {
      if (result.success) {
        await logDeviceEvent(
          req.device.id,
          'scan_success',
          `Scanned: ${itemWithCategory.name}`,
          {
            barcode,
            itemName: itemWithCategory.name,
            categoryName: itemWithCategory.categoryName,
            itemId: itemWithCategory.id,
          }
        );
      } else {
        await logDeviceEvent(
          req.device.id,
          'scan_error',
          result.error || 'Barcode not found',
          {
            barcode,
            error: result.error,
          }
        );
      }
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

    // Broadcast to all connected web clients
    broadcastToAll({
      type: 'item_added',
      item: itemWithCategory,
    });
  } catch (error) {
    console.error('Error processing barcode:', error);
    res.status(500).json({ error: 'Failed to process barcode' });
  }
});

// Add item via API key (for external apps like Home Assistant)
router.post('/api-add', authenticateApiKey, async (req, res) => {
  try {
    const { name, quantity, notes, relatedTo, category, skipLlm } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Item name is required' });
    }

    // Check if Ollama is enabled
    const ollamaEnabled = await isOllamaEnabled();
    const shouldProcess = ollamaEnabled && !skipLlm;

    // First, add the item immediately with processing flag
    const [newItem] = await db.insert(items)
      .values({
        name: name,
        quantity: quantity || null,
        notes: notes || null,
        relatedTo: relatedTo || null,
        categoryId: category ? await findOrCreateCategory(category) : null,
        isProcessing: shouldProcess,
        addedBy: null, // External API, no user
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
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      isCompleted: items.isCompleted,
      isProcessing: items.isProcessing,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .where(eq(items.id, newItem.id))
    .limit(1);

    // Return immediately with processing state
    res.status(201).json(itemWithCategory);

    // Broadcast to all connected web clients
    broadcastToAll({
      type: 'item_added',
      item: itemWithCategory,
    });

    // Process asynchronously if Ollama is enabled and not skipped
    if (shouldProcess) {
      processItemAsync(newItem.id, name, quantity, notes, category);
    }
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

      logger.info('Updating item', {
        userId: req.user.id,
        itemId: id
      });

      // Get current item to check if it's a barcode item
      const [currentItem] = await db.select()
        .from(items)
        .where(eq(items.id, parseInt(id)))
        .limit(1);

      if (!currentItem) {
        logger.warn('Update failed - item not found', { itemId: id });
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
      categoryIcon: categories.icon,
      categoryColor: categories.color,
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

    logger.info('Item updated', {
      userId: req.user.id,
      itemId: id,
      itemName: itemWithCategory.name
    });

    res.json(itemWithCategory);

    // Broadcast to all users
    if (req.user?.id) {
      broadcastToUser(req.user.id, {
        type: 'item_updated',
        item: itemWithCategory,
      });
    }
  } catch (error) {
    logger.error('Error updating item', {
      userId: req.user.id,
      itemId: req.params.id,
      error: error.message
    });
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

    // Broadcast to all users
    if (req.user?.id) {
      broadcastToUser(req.user.id, {
        type: 'item_toggled',
        item: updatedItem,
      });
    }
  } catch (error) {
    console.error('Error toggling item completion:', error);
    res.status(500).json({ error: 'Failed to toggle completion' });
  }
});

// Set item completion status to specific value (for offline queue)
router.put('/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { isCompleted } = req.body;

    if (typeof isCompleted !== 'boolean') {
      return res.status(400).json({ error: 'isCompleted must be a boolean' });
    }

    // Get current item
    const [currentItem] = await db.select()
      .from(items)
      .where(eq(items.id, parseInt(id)))
      .limit(1);

    if (!currentItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Set to specific completion state
    const [updatedItem] = await db.update(items)
      .set({
        isCompleted,
        completedAt: isCompleted ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(items.id, parseInt(id)))
      .returning();

    res.json(updatedItem);

    // Broadcast to all users
    if (req.user?.id) {
      broadcastToUser(req.user.id, {
        type: 'item_toggled',
        item: updatedItem,
      });
    }
  } catch (error) {
    console.error('Error setting item completion:', error);
    res.status(500).json({ error: 'Failed to set completion status' });
  }
});

  // Delete item
  router.delete('/:id', authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      logger.info('Deleting item', {
        userId: req.user.id,
        itemId: id
      });

      const [deletedItem] = await db.delete(items)
        .where(eq(items.id, parseInt(id)))
        .returning();

      if (!deletedItem) {
        logger.warn('Delete failed - item not found', { itemId: id });
        return res.status(404).json({ error: 'Item not found' });
      }

      logger.info('Item deleted', {
        userId: req.user.id,
        itemId: id,
        itemName: deletedItem.name
      });

      res.json({ message: 'Item deleted successfully' });

      // Broadcast to all users
      if (req.user?.id) {
        broadcastToUser(req.user.id, {
          type: 'item_deleted',
          itemId: parseInt(id),
        });
      }
    } catch (error) {
      logger.error('Error deleting item', {
        userId: req.user.id,
        itemId: req.params.id,
        error: error.message
      });
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
