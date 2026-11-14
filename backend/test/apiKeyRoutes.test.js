// Integration tests for the API-key list management routes.
//
// These need a migrated PostgreSQL database and are skipped unless
// TEST_DATABASE_URL is set. Use a throwaway database - the tests create and
// delete their own list, items and API key, but never point this at real data.
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/shoppinglist_test npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set';

const API_KEY = `test-key-${Date.now()}-${Math.random().toString(16).slice(2)}`;

let server;
let baseUrl;
let sql;
let db;
let schema;
let drizzleOps;
let listId;
let apiKeyId;
let sseEvents = [];
let sseAbort;

// api_keys holds either the key itself or (once keys are hashed) its SHA-256
// hash. Build a row that suits whichever schema this checkout has.
function apiKeyRow(table, key, name) {
  if ('keyHash' in table) {
    return {
      name,
      keyHash: crypto.createHash('sha256').update(key, 'utf8').digest('hex'),
      keyLastFour: key.slice(-4),
    };
  }
  return { name, key };
}

async function call(method, path, { body, key = API_KEY, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function addItem(name, extra = {}) {
  const res = await call('POST', '/api/items/api-add', {
    body: { name, skipLlm: true, listId, ...extra },
  });
  assert.equal(res.status, 201);
  return res.body;
}

async function clearItems() {
  await db.delete(schema.items).where(drizzleOps.eq(schema.items.listId, listId));
}

async function waitForEvent(predicate) {
  for (let i = 0; i < 50; i++) {
    const found = sseEvents.find(predicate);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return undefined;
}

before(async () => {
  if (skip) return;

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DISABLE_AUTH = 'true'; // only so the test can open the SSE stream without a user
  process.env.LOG_LEVEL = 'error';

  const express = (await import('express')).default;
  ({ db, sql } = await import('../db/index.js'));
  schema = await import('../db/schema.js');
  drizzleOps = await import('drizzle-orm');
  const itemsRoutes = (await import('../routes/items.js')).default;

  const [apiKey] = await db.insert(schema.apiKeys)
    .values(apiKeyRow(schema.apiKeys, API_KEY, 'route tests'))
    .returning();
  apiKeyId = apiKey.id;
  const [list] = await db.insert(schema.lists).values({ name: 'Route test list' }).returning();
  listId = list.id;

  const app = express();
  app.use(express.json());
  app.use('/api/items', itemsRoutes);
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Listen on the same SSE stream the web UI uses
  sseAbort = new AbortController();
  const stream = await fetch(`${baseUrl}/api/items/events`, { signal: sseAbort.signal });
  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of stream.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          if (frame.startsWith('data: ')) sseEvents.push(JSON.parse(frame.slice(6)));
        }
      }
    } catch {
      // stream aborted at the end of the run
    }
  })();
  await waitForEvent(event => event.type === 'connected');
});

after(async () => {
  if (skip || !server) return;

  sseAbort?.abort();
  await clearItems();
  await db.delete(schema.lists).where(drizzleOps.eq(schema.lists.id, listId));
  await db.delete(schema.apiKeys).where(drizzleOps.eq(schema.apiKeys.id, apiKeyId));
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await sql.end();
});

test('new routes reject missing and invalid API keys', { skip }, async () => {
  const routes = [
    ['GET', '/api/items/api-list'],
    ['POST', '/api/items/api-complete'],
    ['POST', '/api/items/api-remove'],
  ];

  for (const [method, path] of routes) {
    const body = method === 'POST' ? { name: 'milk' } : undefined;

    const missing = await call(method, path, { body, key: null });
    assert.equal(missing.status, 401, `${method} ${path} without key`);
    assert.equal(missing.body.error, 'API key required');

    const invalid = await call(method, path, { body, key: 'not-a-real-key' });
    assert.equal(invalid.status, 403, `${method} ${path} with bad key`);
    assert.equal(invalid.body.error, 'Invalid API key');
  }
});

test('api-add keeps working with the Home Assistant request shape', { skip }, async () => {
  await clearItems();

  const res = await fetch(`${baseUrl}/api/items/api-add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ name: 'Kitchen roll', skipLlm: false }),
  });
  const item = await res.json();

  assert.equal(res.status, 201);
  assert.equal(item.name, 'Kitchen roll');
  assert.equal(item.isCompleted, false);
  assert.equal(item.listId, 1);

  await db.delete(schema.items).where(drizzleOps.eq(schema.items.id, item.id));
});

test('api-list returns open items by default and supports status and X-API-Key', { skip }, async () => {
  await clearItems();
  const milk = await addItem('Milk', { quantity: '2', notes: 'semi skimmed', category: 'Dairy' });
  const bread = await addItem('Bread');
  await call('POST', '/api/items/api-complete', { body: { id: bread.id } });

  const active = await call('GET', `/api/items/api-list?listId=${listId}`);
  assert.equal(active.status, 200);
  assert.equal(active.body.status, 'active');
  assert.equal(active.body.count, 1);
  assert.deepEqual(
    {
      id: active.body.items[0].id,
      name: active.body.items[0].name,
      quantity: active.body.items[0].quantity,
      notes: active.body.items[0].notes,
      categoryName: active.body.items[0].categoryName,
      isCompleted: active.body.items[0].isCompleted,
      listId: active.body.items[0].listId,
      listName: active.body.items[0].listName,
    },
    {
      id: milk.id,
      name: 'Milk',
      quantity: '2',
      notes: 'semi skimmed',
      categoryName: 'Dairy',
      isCompleted: false,
      listId,
      listName: 'Route test list',
    }
  );

  const completed = await call('GET', `/api/items/api-list?listId=${listId}&status=completed`);
  assert.deepEqual(completed.body.items.map(i => i.name), ['Bread']);
  assert.equal(completed.body.items[0].isCompleted, true);

  const all = await call('GET', `/api/items/api-list?listId=${listId}&status=all`, {
    key: null,
    headers: { 'X-API-Key': API_KEY },
  });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map(i => i.name), ['Milk', 'Bread']);

  const badStatus = await call('GET', '/api/items/api-list?status=nope');
  assert.equal(badStatus.status, 400);

  const badList = await call('GET', '/api/items/api-list?listId=abc');
  assert.equal(badList.status, 400);
});

test('api-complete ticks off and un-ticks by id and broadcasts item_toggled', { skip }, async () => {
  await clearItems();
  const milk = await addItem('Milk');
  sseEvents = [];

  const ticked = await call('POST', '/api/items/api-complete', { body: { id: milk.id } });
  assert.equal(ticked.status, 200);
  assert.equal(ticked.body.result, 'matched');
  assert.equal(ticked.body.matchType, 'id');
  assert.equal(ticked.body.item.isCompleted, true);
  assert.ok(ticked.body.item.completedAt);

  const event = await waitForEvent(e => e.type === 'item_toggled' && e.item.id === milk.id);
  assert.ok(event, 'item_toggled SSE event received');
  assert.equal(event.item.isCompleted, true);

  // Idempotent: ticking again keeps it completed
  const again = await call('POST', '/api/items/api-complete', { body: { id: milk.id, completed: true } });
  assert.equal(again.body.item.isCompleted, true);

  const unticked = await call('POST', '/api/items/api-complete', { body: { id: milk.id, completed: false } });
  assert.equal(unticked.status, 200);
  assert.equal(unticked.body.item.isCompleted, false);
  assert.equal(unticked.body.item.completedAt, null);
});

test('api-complete matches by name: exact, fuzzy, not_found and ambiguous', { skip }, async () => {
  await clearItems();
  const milk = await addItem('Milk');
  const oatMilk = await addItem('Oat milk');
  const eggs = await addItem('Eggs');
  await addItem('Broccoli');

  // Exact match wins even though "Oat milk" also contains the word
  const exact = await call('POST', '/api/items/api-complete', { body: { name: 'MILK', listId } });
  assert.equal(exact.status, 200);
  assert.equal(exact.body.matchType, 'exact');
  assert.equal(exact.body.item.id, milk.id);
  assert.equal(exact.body.item.isCompleted, true);

  // "Milk" is now completed, so "milk" resolves to the remaining open item
  const partial = await call('POST', '/api/items/api-complete', { body: { name: 'milk', listId } });
  assert.equal(partial.body.matchType, 'partial');
  assert.equal(partial.body.item.id, oatMilk.id);

  const plural = await call('POST', '/api/items/api-complete', { body: { name: 'egg', listId } });
  assert.equal(plural.body.matchType, 'plural');
  assert.equal(plural.body.item.id, eggs.id);

  const fuzzy = await call('POST', '/api/items/api-complete', { body: { name: 'brocoli', listId } });
  assert.equal(fuzzy.body.matchType, 'fuzzy');
  assert.equal(fuzzy.body.item.name, 'Broccoli');

  const notFound = await call('POST', '/api/items/api-complete', { body: { name: 'caviar', listId } });
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.result, 'not_found');
  assert.equal(notFound.body.query, 'caviar');
  assert.ok(notFound.body.error);

  // Un-tick by name looks among completed items ("Milk" and "Oat milk" are both
  // completed; the exact match wins). listId may be sent as a string.
  const unticked = await call('POST', '/api/items/api-complete', {
    body: { name: 'milk', completed: false, listId: String(listId) },
  });
  assert.equal(unticked.status, 200);
  assert.equal(unticked.body.matchType, 'exact');
  assert.equal(unticked.body.item.id, milk.id);
  assert.equal(unticked.body.item.isCompleted, false);

  // An open item is not found when looking for something to un-tick
  const notCompleted = await call('POST', '/api/items/api-complete', {
    body: { name: 'milk chocolate', completed: false, listId },
  });
  assert.equal(notCompleted.status, 404);
  assert.equal(notCompleted.body.result, 'not_found');
});

test('ambiguous names are reported with candidates and nothing is changed', { skip }, async () => {
  await clearItems();
  const oat = await addItem('Oat milk', { quantity: '1' });
  const semi = await addItem('Semi skimmed milk');
  await addItem('Bread');
  sseEvents = [];

  for (const path of ['/api/items/api-complete', '/api/items/api-remove']) {
    const res = await call('POST', path, { body: { name: 'milk', listId } });
    assert.equal(res.status, 409, path);
    assert.equal(res.body.result, 'ambiguous');
    assert.equal(res.body.matchType, 'partial');
    assert.equal(res.body.query, 'milk');
    assert.ok(res.body.error);
    assert.deepEqual(res.body.candidates.map(c => c.id).sort(), [oat.id, semi.id].sort());
    assert.deepEqual(res.body.candidates.map(c => c.name).sort(), ['Oat milk', 'Semi skimmed milk']);
  }

  const list = await call('GET', `/api/items/api-list?listId=${listId}`);
  assert.equal(list.body.count, 3, 'no item was completed or removed');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(
    sseEvents.filter(e => e.type === 'item_toggled' || e.type === 'item_deleted'),
    [],
    'nothing was broadcast'
  );

  // The agent can then disambiguate with a fuller name
  const resolved = await call('POST', '/api/items/api-complete', { body: { name: 'oat milk', listId } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.item.id, oat.id);
});

test('api-remove deletes by id and by name and broadcasts item_deleted', { skip }, async () => {
  await clearItems();
  const milk = await addItem('Milk');
  const bread = await addItem('Bread');
  const done = await addItem('Butter');
  await call('POST', '/api/items/api-complete', { body: { id: done.id } });
  sseEvents = [];

  const byName = await call('POST', '/api/items/api-remove', { body: { name: 'bread', listId } });
  assert.equal(byName.status, 200);
  assert.equal(byName.body.result, 'matched');
  assert.equal(byName.body.matchType, 'exact');
  assert.equal(byName.body.item.id, bread.id);
  assert.equal(byName.body.item.name, 'Bread');

  const event = await waitForEvent(e => e.type === 'item_deleted' && e.itemId === bread.id);
  assert.ok(event, 'item_deleted SSE event received');

  const byId = await call('POST', '/api/items/api-remove', { body: { id: milk.id } });
  assert.equal(byId.status, 200);
  assert.equal(byId.body.matchType, 'id');

  // Name lookups only consider open items, so the completed "Butter" is not removed by name
  const completedByName = await call('POST', '/api/items/api-remove', { body: { name: 'butter', listId } });
  assert.equal(completedByName.status, 404);
  assert.equal(completedByName.body.result, 'not_found');

  const goneById = await call('POST', '/api/items/api-remove', { body: { id: milk.id } });
  assert.equal(goneById.status, 404);
  assert.equal(goneById.body.result, 'not_found');

  const list = await call('GET', `/api/items/api-list?listId=${listId}&status=all`);
  assert.deepEqual(list.body.items.map(i => i.name), ['Butter']);
});

test('request validation', { skip }, async () => {
  for (const path of ['/api/items/api-complete', '/api/items/api-remove']) {
    const neither = await call('POST', path, { body: { listId } });
    assert.equal(neither.status, 400, path);
    assert.equal(neither.body.error, 'Item id or name is required');

    const blank = await call('POST', path, { body: { name: '   ' } });
    assert.equal(blank.status, 400, path);

    const badId = await call('POST', path, { body: { id: 'abc' } });
    assert.equal(badId.status, 400, path);

    const badList = await call('POST', path, { body: { name: 'milk', listId: -1 } });
    assert.equal(badList.status, 400, path);
  }

  const badCompleted = await call('POST', '/api/items/api-complete', { body: { name: 'milk', completed: 'yes' } });
  assert.equal(badCompleted.status, 400);
  assert.equal(badCompleted.body.error, 'completed must be a boolean');
});
