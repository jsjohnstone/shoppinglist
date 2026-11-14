// Integration tests for the AUTH_MODE setting (full / admin / none).
//
// These need a migrated PostgreSQL database and are skipped unless
// TEST_DATABASE_URL is set. Use a throwaway database - the tests create and
// delete their own users, list and items, but never point this at real data.
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/shoppinglist_test npm test

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set';

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ADMIN_NAME = `admin-${suffix}`;
const API_KEY = `test-key-${suffix}`;
const savedEnv = { AUTH_MODE: process.env.AUTH_MODE, DISABLE_AUTH: process.env.DISABLE_AUTH };

let server;
let baseUrl;
let sql;
let db;
let schema;
let ops;
let adminToken;
let listId;
let hadUsersAtStart;
const createdUsernames = [ADMIN_NAME];

async function call(method, path, { body, token } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

// Opens the SSE stream the web UI uses and collects its events
async function openEventStream(token) {
  const controller = new AbortController();
  const events = [];
  const url = `${baseUrl}/api/items/events${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  const res = await fetch(url, { signal: controller.signal });

  if (res.status !== 200) {
    controller.abort();
    return { status: res.status, events, close: () => {} };
  }

  (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          if (frame.startsWith('data: ')) events.push(JSON.parse(frame.slice(6)));
        }
      }
    } catch {
      // stream closed by the test
    }
  })();

  const waitFor = async (predicate) => {
    for (let i = 0; i < 50; i++) {
      const found = events.find(predicate);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    return undefined;
  };

  await waitFor(event => event.type === 'connected');
  return { status: 200, events, waitFor, close: () => controller.abort() };
}

// Routes for everyday use of the list
const listRoutes = [
  ['GET', '/api/items'],
  ['GET', '/api/lists'],
  ['GET', '/api/categories'],
];

// Routes that change how the app is set up or who can use it
const adminRoutes = [
  ['GET', '/api/auth/me'],
  ['GET', '/api/settings'],
  ['GET', '/api/settings/ollama'],
  ['PUT', '/api/settings/ollama', { enabled: false }],
  ['GET', '/api/settings/homeassistant'],
  ['GET', '/api/settings/tts-phrases'],
  ['GET', '/api/api-keys'],
  ['POST', '/api/api-keys', { name: 'should not be created' }],
  ['DELETE', '/api/api-keys/999999'],
  ['GET', '/api/devices'],
  ['PATCH', '/api/devices/999999/approve', { friendly_name: 'x', ha_speaker_entity: 'y' }],
  ['DELETE', '/api/devices/999999'],
  ['GET', '/api/homeassistant/entities'],
  ['POST', '/api/lists', { name: 'should not be created' }],
  ['PUT', '/api/lists/999999', { name: 'x' }],
  ['DELETE', '/api/lists/999999'],
  ['PUT', '/api/categories/999999', { name: 'x' }],
  ['DELETE', '/api/categories/999999'],
];

before(async () => {
  if (skip) return;

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.LOG_LEVEL = 'error';
  delete process.env.DISABLE_AUTH;

  const express = (await import('express')).default;
  ({ db, sql } = await import('../db/index.js'));
  schema = await import('../db/schema.js');
  ops = await import('drizzle-orm');
  const { generateToken } = await import('../middleware/auth.js');

  const realUsers = await db.select().from(schema.users).where(ops.ne(schema.users.username, 'default'));
  hadUsersAtStart = realUsers.length > 0;

  const app = express();
  app.use(express.json());
  for (const name of ['auth', 'items', 'categories', 'apiKeys', 'devices', 'homeassistant', 'settings', 'lists']) {
    const path = { apiKeys: 'api-keys' }[name] || name;
    app.use(`/api/${path}`, (await import(`../routes/${name}.js`)).default);
  }
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // First-run setup: with the list open and no accounts yet, anyone may create the first one
  if (!hadUsersAtStart) {
    process.env.AUTH_MODE = 'admin';
    const config = await call('GET', '/api/auth/config');
    assert.deepEqual(config.body, { authRequired: false, authMode: 'admin', registrationOpen: true });

    const first = await call('POST', '/api/auth/register', { body: { username: ADMIN_NAME, password: 'test-password' } });
    assert.equal(first.status, 201, 'first account can be created without a login');
    adminToken = first.body.token;
  } else {
    const [user] = await db.insert(schema.users)
      .values({ username: ADMIN_NAME, passwordHash: 'not-a-real-hash' })
      .returning();
    adminToken = generateToken(user);
  }

  await db.insert(schema.apiKeys).values({ key: API_KEY, name: 'auth mode tests' });
  const [list] = await db.insert(schema.lists).values({ name: `Auth mode test list ${suffix}` }).returning();
  listId = list.id;
});

beforeEach(() => {
  delete process.env.DISABLE_AUTH;
  delete process.env.AUTH_MODE;
});

after(async () => {
  if (skip || !server) return;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  await db.delete(schema.items).where(ops.eq(schema.items.listId, listId));
  await db.delete(schema.lists).where(ops.eq(schema.lists.id, listId));
  await db.delete(schema.apiKeys).where(ops.eq(schema.apiKeys.key, API_KEY));
  await db.delete(schema.users).where(ops.inArray(schema.users.username, createdUsernames));
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await sql.end();
});

test('full mode: everything needs a login, as before', { skip }, async () => {
  process.env.AUTH_MODE = 'full';

  const config = await call('GET', '/api/auth/config');
  assert.deepEqual(config.body, { authRequired: true, authMode: 'full', registrationOpen: true });

  for (const [method, path, body] of [...listRoutes, ...adminRoutes]) {
    const missing = await call(method, path, { body });
    assert.equal(missing.status, 401, `${method} ${path} without login`);
    assert.equal(missing.body.error, 'Access token required');

    const invalid = await call(method, path, { body, token: 'not-a-token' });
    assert.equal(invalid.status, 403, `${method} ${path} with bad token`);
  }

  const add = await call('POST', '/api/items', { body: { name: 'Milk', skipLlm: true, listId } });
  assert.equal(add.status, 401);

  const stream = await openEventStream();
  assert.equal(stream.status, 401);

  const loggedIn = await call('GET', `/api/items?listId=${listId}`, { token: adminToken });
  assert.equal(loggedIn.status, 200);
  const settings = await call('GET', '/api/settings', { token: adminToken });
  assert.equal(settings.status, 200);
});

test('admin mode: the list works without a login', { skip }, async () => {
  process.env.AUTH_MODE = 'admin';

  const config = await call('GET', '/api/auth/config');
  assert.deepEqual(config.body, { authRequired: false, authMode: 'admin', registrationOpen: false });

  for (const [method, path] of listRoutes) {
    const res = await call(method, path);
    assert.equal(res.status, 200, `${method} ${path} without login`);
  }

  const added = await call('POST', '/api/items', { body: { name: 'Milk', skipLlm: true, listId } });
  assert.equal(added.status, 201);
  const [row] = await db.select().from(schema.items).where(ops.eq(schema.items.id, added.body.id));
  assert.equal(row.addedBy, null, 'anonymous items have no owner');

  const bulk = await call('POST', '/api/items/bulk-add', { body: { items: ['Bread', 'Eggs'], listId } });
  assert.equal(bulk.status, 201);

  const edited = await call('PUT', `/api/items/${added.body.id}`, { body: { name: 'Oat milk', quantity: '2' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.name, 'Oat milk');

  const ticked = await call('PATCH', `/api/items/${added.body.id}/complete`);
  assert.equal(ticked.body.isCompleted, true);
  const unticked = await call('PUT', `/api/items/${added.body.id}/complete`, { body: { isCompleted: false } });
  assert.equal(unticked.body.isCompleted, false);

  const reordered = await call('POST', '/api/items/reorder', { body: { itemOrders: [{ id: added.body.id, sortOrder: 3 }] } });
  assert.equal(reordered.status, 200);

  const moved = await call('PUT', `/api/items/${added.body.id}/move`, { body: { listId } });
  assert.equal(moved.status, 200);

  // A stale or invalid stored login must not break the list
  const stale = await call('GET', `/api/items?listId=${listId}`, { token: 'not-a-token' });
  assert.equal(stale.status, 200);

  const removed = await call('DELETE', `/api/items/${added.body.id}`);
  assert.equal(removed.status, 200);
});

test('admin mode: administration needs a login', { skip }, async () => {
  process.env.AUTH_MODE = 'admin';

  for (const [method, path, body] of adminRoutes) {
    const missing = await call(method, path, { body });
    assert.equal(missing.status, 401, `${method} ${path} without login`);
    assert.equal(missing.body.error, 'Access token required');

    const invalid = await call(method, path, { body, token: 'not-a-token' });
    assert.equal(invalid.status, 403, `${method} ${path} with bad token`);
  }

  const reorderLists = await call('POST', '/api/lists/reorder', { body: { listOrders: [] } });
  assert.equal(reorderLists.status, 401);
  const reorderCategories = await call('POST', '/api/categories/reorder', { body: { categoryOrders: [] } });
  assert.equal(reorderCategories.status, 401);

  const lists = await db.select().from(schema.lists).where(ops.eq(schema.lists.name, 'should not be created'));
  assert.equal(lists.length, 0);
  const keys = await db.select().from(schema.apiKeys).where(ops.eq(schema.apiKeys.name, 'should not be created'));
  assert.equal(keys.length, 0);

  // Logged in, the same areas open up
  for (const path of ['/api/auth/me', '/api/settings', '/api/settings/ollama', '/api/api-keys', '/api/devices']) {
    const res = await call('GET', path, { token: adminToken });
    assert.equal(res.status, 200, `GET ${path} with login`);
  }
});

test('admin mode: registration is closed unless logged in', { skip }, async () => {
  process.env.AUTH_MODE = 'admin';

  const stranger = `stranger-${suffix}`;
  const refused = await call('POST', '/api/auth/register', { body: { username: stranger, password: 'test-password' } });
  assert.equal(refused.status, 403);
  const strangers = await db.select().from(schema.users).where(ops.eq(schema.users.username, stranger));
  assert.equal(strangers.length, 0);

  const second = `second-${suffix}`;
  createdUsernames.push(second);
  const byAdmin = await call('POST', '/api/auth/register', {
    body: { username: second, password: 'test-password' },
    token: adminToken,
  });
  assert.equal(byAdmin.status, 201);

  // Existing accounts can still log in
  const login = await call('POST', '/api/auth/login', { body: { username: second, password: 'test-password' } });
  assert.equal(login.status, 200);
  const settings = await call('GET', '/api/settings', { token: login.body.token });
  assert.equal(settings.status, 200);
});

test('full mode: registration stays open, as before', { skip }, async () => {
  process.env.AUTH_MODE = 'full';

  const username = `open-${suffix}`;
  createdUsernames.push(username);
  const res = await call('POST', '/api/auth/register', { body: { username, password: 'test-password' } });
  assert.equal(res.status, 201);
});

test('admin mode: list changes reach every connected client', { skip }, async () => {
  process.env.AUTH_MODE = 'admin';

  const anonymous = await openEventStream();
  const staleLogin = await openEventStream('not-a-token');
  const loggedIn = await openEventStream(adminToken);
  assert.equal(anonymous.status, 200);
  assert.equal(staleLogin.status, 200);
  assert.equal(loggedIn.status, 200);

  try {
    // A change made without a login...
    const added = await call('POST', '/api/items', { body: { name: 'Butter', skipLlm: true, listId } });
    for (const stream of [anonymous, staleLogin, loggedIn]) {
      assert.ok(await stream.waitFor(e => e.type === 'item_added' && e.item.id === added.body.id));
    }

    // ...and one made by a logged-in user
    await call('PATCH', `/api/items/${added.body.id}/complete`, { token: adminToken });
    for (const stream of [anonymous, staleLogin, loggedIn]) {
      assert.ok(await stream.waitFor(e => e.type === 'item_toggled' && e.item.id === added.body.id));
    }

    const bulk = await call('POST', '/api/items/bulk-add', { body: { items: ['Jam'], listId } });
    assert.ok(await anonymous.waitFor(e => e.type === 'item_added' && e.item.id === bulk.body.items[0].id));

    await call('DELETE', `/api/items/${added.body.id}`);
    for (const stream of [anonymous, staleLogin, loggedIn]) {
      assert.ok(await stream.waitFor(e => e.type === 'item_deleted' && e.itemId === added.body.id));
    }
  } finally {
    anonymous.close();
    staleLogin.close();
    loggedIn.close();
  }
});

test('none mode and DISABLE_AUTH=true: nothing needs a login', { skip }, async () => {
  for (const env of [{ AUTH_MODE: 'none' }, { DISABLE_AUTH: 'true' }]) {
    delete process.env.AUTH_MODE;
    delete process.env.DISABLE_AUTH;
    Object.assign(process.env, env);

    const config = await call('GET', '/api/auth/config');
    assert.deepEqual(config.body, { authRequired: false, authMode: 'none', registrationOpen: true });

    for (const path of ['/api/items', '/api/lists', '/api/categories', '/api/settings', '/api/api-keys', '/api/devices']) {
      const res = await call('GET', path);
      assert.equal(res.status, 200, `GET ${path} with ${JSON.stringify(env)}`);
    }

    const stream = await openEventStream();
    assert.equal(stream.status, 200);
    stream.close();
  }
});

test('API-key routes need a key in every mode', { skip }, async () => {
  for (const mode of ['full', 'admin', 'none']) {
    process.env.AUTH_MODE = mode;

    const noKey = await call('POST', '/api/items/api-add', { body: { name: 'Milk', skipLlm: true, listId } });
    assert.equal(noKey.status, 401, `api-add without key in ${mode} mode`);

    const login = await call('POST', '/api/items/api-add', { body: { name: 'Milk', skipLlm: true, listId }, token: adminToken });
    assert.equal(login.status, 403, `api-add with a login instead of a key in ${mode} mode`);

    const withKey = await call('POST', '/api/items/api-add', { body: { name: 'Milk', skipLlm: true, listId }, token: API_KEY });
    assert.equal(withKey.status, 201, `api-add with key in ${mode} mode`);

    const scanner = await call('POST', '/api/items/barcode', { body: { barcode: '123' } });
    assert.equal(scanner.status, 401, `barcode without device token in ${mode} mode`);
  }
});
