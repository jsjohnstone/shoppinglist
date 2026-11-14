import express from 'express';
import { db } from '../db/index.js';
import { items, categories, lists } from '../db/schema.js';
import { eq, and, or, desc } from 'drizzle-orm';
import { authenticateToken, getAuthMode } from '../middleware/auth.js';
import { authenticateApiKey } from '../middleware/apiKey.js';
import { authenticateDevice } from '../middleware/deviceAuth.js';
import { processItem, isOllamaEnabled } from '../services/llm.js';
import { processBarcode, isBarcode } from '../services/barcode.js';
import { logDeviceEvent } from '../services/deviceEvents.js';
import { matchItemByName } from '../services/itemMatcher.js';
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

// Helper to broadcast a change made through the web UI. Normally this goes to
// the acting user's own clients. When the list is open without a login
// (AUTH_MODE=admin) there may be no user, so everyone gets it.
function broadcastItemEvent(req, event) {
  if (getAuthMode() === 'admin') {
    broadcastToAll(event);
  } else if (req.user?.id) {
    broadcastToUser(req.user.id, event);
  }
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
    let user;

    const authMode = getAuthMode();
    // With the list open (AUTH_MODE=admin) a login is optional here
    const anonymousUser = { id: null, username: 'anonymous' };

    if (authMode === 'none') {
      user = { id: 1, username: 'default' };
    } else {
      // EventSource doesn't support custom headers, so we accept token via query param
      const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');

      if (!token && authMode === 'admin') {
        user = anonymousUser;
      } else if (!token) {
        logger.warn('SSE connection rejected - no token');
        return res.status(401).json({ error: 'No authentication token provided' });
      } else {
        // Verify token
        try {
          const jwt = await import('jsonwebtoken');
          const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'your-secret-key');
          user = decoded;
        } catch (error) {
          if (authMode === 'admin') {
            user = anonymousUser;
          } else {
            logger.warn('SSE connection rejected - invalid token');
            return res.status(401).json({ error: 'Invalid authentication token' });
          }
        }
      }
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
    const { status, relatedTo, listId } = req.query;

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
      listId: items.listId,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .orderBy(items.isCompleted, items.sortOrder, desc(items.createdAt));

    const conditions = [];

    if (listId) {
      conditions.push(eq(items.listId, parseInt(listId)));
    }

    // Filter by completion status
    if (status === 'active') {
      conditions.push(eq(items.isCompleted, false));
    } else if (status === 'completed') {
      conditions.push(eq(items.isCompleted, true));
    }

    // Filter by relatedTo
    if (relatedTo) {
      conditions.push(eq(items.relatedTo, relatedTo));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
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
      const { items: itemTexts, relatedTo, categoryId, listId } = req.body;

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
          listId: listId || 1,
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
          listId: items.listId,
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

    // Broadcast to connected web clients
    for (const item of itemsWithCategories) {
      broadcastItemEvent(req, {
        type: 'item_added',
        item,
      });
    }

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
      const { name, quantity, notes, relatedTo, category, skipLlm, listId } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Item name is required' });
      }

      // Check if this is a barcode
      const isBarcodeInput = isBarcode(name);

      logger.info('Adding item', {
        userId: req.user.id,
        itemName: name,
        isBarcode: isBarcodeInput,
        category,
        listId,
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
        listId: listId || 1,
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
      listId: items.listId,
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

    // Broadcast to connected web clients
    broadcastItemEvent(req, {
      type: 'item_added',
      item: itemWithCategory,
    });

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
        listId: items.listId,
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
    const { name, quantity, notes, relatedTo, category, skipLlm, listId } = req.body;

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
        listId: listId || 1,
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
      listId: items.listId,
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

// ---------------------------------------------------------------------------
// API-key list management (for external apps like Home Assistant voice agents
// and display clients). These mirror the JWT routes but authenticate with an
// API key and can target an item by name as well as by id.
// ---------------------------------------------------------------------------

// Item fields returned to API-key clients
const apiItemFields = {
  id: items.id,
  name: items.name,
  quantity: items.quantity,
  notes: items.notes,
  relatedTo: items.relatedTo,
  categoryId: items.categoryId,
  categoryName: categories.name,
  isCompleted: items.isCompleted,
  isProcessing: items.isProcessing,
  completedAt: items.completedAt,
  listId: items.listId,
  listName: lists.name,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
};

function selectApiItems() {
  return db.select(apiItemFields)
    .from(items)
    .leftJoin(categories, eq(items.categoryId, categories.id))
    .leftJoin(lists, eq(items.listId, lists.id));
}

// Parse an optional positive integer (id / listId) from a body or query value.
// Returns undefined when absent, NaN when present but invalid.
function parseOptionalId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

// Resolve the item an API-key request refers to, by id or by name.
// Returns { item, matchType } on success, otherwise sends the error response
// and returns null. Name lookups only consider items whose completion state
// is `isCompleted`, optionally limited to one list.
async function resolveApiItem(req, res, { isCompleted }) {
  const { name } = req.body;
  const id = parseOptionalId(req.body.id);
  const listId = parseOptionalId(req.body.listId);

  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'id must be a positive integer' });
    return null;
  }

  if (Number.isNaN(listId)) {
    res.status(400).json({ error: 'listId must be a positive integer' });
    return null;
  }

  if (id !== undefined) {
    const [item] = await selectApiItems().where(eq(items.id, id)).limit(1);

    if (!item) {
      res.status(404).json({ error: 'Item not found', result: 'not_found' });
      return null;
    }

    return { item, matchType: 'id' };
  }

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Item id or name is required' });
    return null;
  }

  const conditions = [eq(items.isCompleted, isCompleted)];
  if (listId !== undefined) {
    conditions.push(eq(items.listId, listId));
  }

  const candidates = await selectApiItems()
    .where(and(...conditions))
    .orderBy(items.sortOrder, desc(items.createdAt));

  const match = matchItemByName(name, candidates);

  if (match.result === 'not_found') {
    res.status(404).json({
      error: `No ${isCompleted ? 'completed' : 'open'} item matching "${name.trim()}"`,
      result: 'not_found',
      query: name.trim(),
    });
    return null;
  }

  if (match.result === 'ambiguous') {
    res.status(409).json({
      error: `Multiple items match "${name.trim()}"`,
      result: 'ambiguous',
      query: name.trim(),
      matchType: match.matchType,
      candidates: match.candidates,
    });
    return null;
  }

  return { item: match.item, matchType: match.matchType };
}

// Read the list via API key
router.get('/api-list', authenticateApiKey, async (req, res) => {
  try {
    const status = req.query.status || 'active';
    const listId = parseOptionalId(req.query.listId);

    if (!['active', 'completed', 'all'].includes(status)) {
      return res.status(400).json({ error: 'status must be one of: active, completed, all' });
    }

    if (Number.isNaN(listId)) {
      return res.status(400).json({ error: 'listId must be a positive integer' });
    }

    const conditions = [];

    if (status === 'active') {
      conditions.push(eq(items.isCompleted, false));
    } else if (status === 'completed') {
      conditions.push(eq(items.isCompleted, true));
    }

    if (listId !== undefined) {
      conditions.push(eq(items.listId, listId));
    }

    let query = selectApiItems();

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    const listItems = await query
      .orderBy(items.isCompleted, items.sortOrder, desc(items.createdAt));

    res.json({
      status,
      count: listItems.length,
      items: listItems,
    });
  } catch (error) {
    console.error('Error fetching items via API:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Tick an item off (or un-tick it) via API key, by id or by name
router.post('/api-complete', authenticateApiKey, async (req, res) => {
  try {
    const completed = req.body.completed === undefined ? true : req.body.completed;

    if (typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean' });
    }

    // Ticking off looks among open items; un-ticking looks among completed ones
    const resolved = await resolveApiItem(req, res, { isCompleted: !completed });
    if (!resolved) return;

    await db.update(items)
      .set({
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(items.id, resolved.item.id));

    const [updatedItem] = await selectApiItems()
      .where(eq(items.id, resolved.item.id))
      .limit(1);

    if (!updatedItem) {
      return res.status(404).json({ error: 'Item not found', result: 'not_found' });
    }

    logger.info('Item completion set via API key', {
      apiKeyId: req.apiKey.id,
      itemId: updatedItem.id,
      itemName: updatedItem.name,
      isCompleted: completed,
      matchType: resolved.matchType,
    });

    res.json({
      result: 'matched',
      matchType: resolved.matchType,
      item: updatedItem,
    });

    // Broadcast to all connected web clients
    broadcastToAll({
      type: 'item_toggled',
      item: updatedItem,
    });
  } catch (error) {
    console.error('Error setting item completion via API:', error);
    res.status(500).json({ error: 'Failed to set completion status' });
  }
});

// Remove an item via API key, by id or by name
router.post('/api-remove', authenticateApiKey, async (req, res) => {
  try {
    // Name lookups only consider open items
    const resolved = await resolveApiItem(req, res, { isCompleted: false });
    if (!resolved) return;

    const [deletedItem] = await db.delete(items)
      .where(eq(items.id, resolved.item.id))
      .returning();

    if (!deletedItem) {
      return res.status(404).json({ error: 'Item not found', result: 'not_found' });
    }

    logger.info('Item deleted via API key', {
      apiKeyId: req.apiKey.id,
      itemId: resolved.item.id,
      itemName: resolved.item.name,
      matchType: resolved.matchType,
    });

    res.json({
      result: 'matched',
      matchType: resolved.matchType,
      item: resolved.item,
    });

    // Broadcast to all connected web clients
    broadcastToAll({
      type: 'item_deleted',
      itemId: resolved.item.id,
    });
  } catch (error) {
    console.error('Error deleting item via API:', error);
    res.status(500).json({ error: 'Failed to delete item' });
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
      listId: items.listId,
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

    // Broadcast to connected web clients
    broadcastItemEvent(req, {
      type: 'item_updated',
      item: itemWithCategory,
    });
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

    // Broadcast to connected web clients
    broadcastItemEvent(req, {
      type: 'item_toggled',
      item: updatedItem,
    });
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

    // Broadcast to connected web clients
    broadcastItemEvent(req, {
      type: 'item_toggled',
      item: updatedItem,
    });
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

      // Broadcast to connected web clients
      broadcastItemEvent(req, {
        type: 'item_deleted',
        itemId: parseInt(id),
      });
    } catch (error) {
      logger.error('Error deleting item', {
        userId: req.user.id,
        itemId: req.params.id,
        error: error.message
      });
      res.status(500).json({ error: 'Failed to delete item' });
    }
  });

// Move item to a different list
router.put('/:id/move', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { listId } = req.body;

    if (!listId) {
      return res.status(400).json({ error: 'listId is required' });
    }

    const [list] = await db.select().from(lists).where(eq(lists.id, parseInt(listId))).limit(1);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const [currentItem] = await db.select().from(items).where(eq(items.id, parseInt(id))).limit(1);
    if (!currentItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const fromListId = currentItem.listId;

    const [updated] = await db.update(items)
      .set({ listId: parseInt(listId), updatedAt: new Date() })
      .where(eq(items.id, parseInt(id)))
      .returning();

    broadcastToAll({
      type: 'item_moved',
      item: updated,
      fromListId,
      toListId: parseInt(listId),
    });

    res.json(updated);
  } catch (error) {
    console.error('Error moving item:', error);
    res.status(500).json({ error: 'Failed to move item' });
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
