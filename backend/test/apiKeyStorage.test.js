// Integration tests for hashed API key storage.
//
// These need a migrated PostgreSQL database and are skipped unless
// TEST_DATABASE_URL is set. Use a throwaway database - the tests create and
// delete their own keys and items (and a scratch schema for the migration
// test), but never point this at real data.
//
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/shoppinglist_test npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hashApiKey } from '../services/apiKeys.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL not set';

const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const migrationSql = fs.readFileSync(new URL('../../drizzle/0011_hash_api_keys.sql', import.meta.url), 'utf8');
const savedEnv = { AUTH_MODE: process.env.AUTH_MODE, DISABLE_AUTH: process.env.DISABLE_AUTH };

let server;
let baseUrl;
let sql;
let db;
let schema;
let ops;
const createdKeyIds = [];
const createdItemIds = [];

async function call(method, path, { body, headers } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function apiAdd(headers) {
  const res = await call('POST', '/api/items/api-add', {
    body: { name: `Key storage test ${suffix}`, skipLlm: true },
    headers,
  });
  if (res.status === 201) createdItemIds.push(res.body.id);
  return res;
}

before(async () => {
  if (skip) return;

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.LOG_LEVEL = 'error';
  // Key management needs a login; switch it off so the test can call it directly
  delete process.env.AUTH_MODE;
  process.env.DISABLE_AUTH = 'true';

  const express = (await import('express')).default;
  ({ db, sql } = await import('../db/index.js'));
  schema = await import('../db/schema.js');
  ops = await import('drizzle-orm');

  const app = express();
  app.use(express.json());
  app.use('/api/items', (await import('../routes/items.js')).default);
  app.use('/api/api-keys', (await import('../routes/apiKeys.js')).default);
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (skip || !server) return;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  if (createdItemIds.length) {
    await db.delete(schema.items).where(ops.inArray(schema.items.id, createdItemIds));
  }
  if (createdKeyIds.length) {
    await db.delete(schema.apiKeys).where(ops.inArray(schema.apiKeys.id, createdKeyIds));
  }
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await sql.end();
});

test('a new key is returned once, stored only as a hash, and authenticates', { skip }, async () => {
  const created = await call('POST', '/api/api-keys', { body: { name: `storage test ${suffix}` } });
  assert.equal(created.status, 201);
  createdKeyIds.push(created.body.id);

  const key = created.body.key;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(created.body.keyLastFour, key.slice(-4));
  assert.equal(created.body.name, `storage test ${suffix}`);
  assert.equal('keyHash' in created.body, false);

  // The table holds the hash and the last four characters, not the key
  const [row] = await sql`SELECT * FROM api_keys WHERE id = ${created.body.id}`;
  assert.equal(row.key_hash, hashApiKey(key));
  assert.equal(row.key_last_four, key.slice(-4));
  assert.equal('key' in row, false);
  assert.equal(Object.values(row).includes(key), false);

  // Listing never returns the key or its hash
  const list = await call('GET', '/api/api-keys');
  assert.equal(list.status, 200);
  const listed = list.body.find(k => k.id === created.body.id);
  assert.deepEqual(Object.keys(listed).sort(), ['createdAt', 'id', 'keyLastFour', 'name']);
  assert.equal(JSON.stringify(list.body).includes(key), false);
  assert.equal(JSON.stringify(list.body).includes(hashApiKey(key)), false);

  // The key works with both header styles
  assert.equal((await apiAdd({ Authorization: `Bearer ${key}` })).status, 201);
  assert.equal((await apiAdd({ 'X-API-Key': key })).status, 201);

  // The stored hash is not itself a key
  assert.equal((await apiAdd({ Authorization: `Bearer ${hashApiKey(key)}` })).status, 403);
  assert.equal((await apiAdd({ Authorization: 'Bearer not-a-real-key' })).status, 403);
  assert.equal((await apiAdd({})).status, 401);

  // A deleted key stops working
  const deleted = await call('DELETE', `/api/api-keys/${created.body.id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await apiAdd({ Authorization: `Bearer ${key}` })).status, 403);
});

test('the migration hashes existing plaintext keys in place and can run twice', { skip }, async () => {
  const postgres = (await import('postgres')).default;
  const schemaName = `key_migration_${suffix}`;
  // One dedicated connection, pointed at a scratch schema, so the real
  // api_keys table is not touched
  const scratch = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });

  try {
    await scratch.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await scratch.unsafe(`SET search_path TO "${schemaName}"`);

    // The table as created by the original migration (0000)
    await scratch.unsafe(`
      CREATE TABLE "api_keys" (
        "id" serial PRIMARY KEY NOT NULL,
        "key" varchar(255) NOT NULL,
        "name" varchar(255),
        "created_at" timestamp DEFAULT now(),
        CONSTRAINT "api_keys_key_unique" UNIQUE("key")
      )
    `);

    const plaintext = {
      'Home Assistant': 'a8e9fdfcfb778be2c53752edc4dc93376723213673f058009cde1f3820949fc2',
      'Barcode scanner': 'made-up-key-with-ünicode-and-symbols!',
    };
    for (const [name, key] of Object.entries(plaintext)) {
      await scratch`INSERT INTO api_keys (key, name) VALUES (${key}, ${name})`;
    }
    const before = await scratch`SELECT id, name, created_at FROM api_keys ORDER BY id`;

    await scratch.unsafe(migrationSql);

    const columns = (await scratch`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = ${schemaName} AND table_name = 'api_keys'
    `).map(c => c.column_name).sort();
    assert.deepEqual(columns, ['created_at', 'id', 'key_hash', 'key_last_four', 'name']);

    const migrated = await scratch`SELECT * FROM api_keys ORDER BY id`;
    assert.equal(migrated.length, 2);
    for (const [index, row] of migrated.entries()) {
      const key = plaintext[row.name];
      assert.equal(row.key_hash, hashApiKey(key), `${row.name} hashes the same way the server does`);
      assert.equal(row.key_last_four, key.slice(-4));
      assert.equal(row.id, before[index].id);
      assert.deepEqual(row.created_at, before[index].created_at);
      assert.equal(JSON.stringify(row).includes(key), false, 'plaintext is gone');
    }

    // Second run changes nothing
    await scratch.unsafe(migrationSql);
    assert.deepEqual(await scratch`SELECT * FROM api_keys ORDER BY id`, migrated);

    // The hash column still rejects duplicates and missing values
    await assert.rejects(scratch`INSERT INTO api_keys (key_hash, name) VALUES (${migrated[0].key_hash}, 'dup')`);
    await assert.rejects(scratch`INSERT INTO api_keys (name) VALUES ('no hash')`);

    // An empty table in the original shape migrates too
    await scratch.unsafe(`
      DROP TABLE "api_keys";
      CREATE TABLE "api_keys" (
        "id" serial PRIMARY KEY NOT NULL,
        "key" varchar(255) NOT NULL,
        "name" varchar(255),
        "created_at" timestamp DEFAULT now(),
        CONSTRAINT "api_keys_key_unique" UNIQUE("key")
      )
    `);
    await scratch.unsafe(migrationSql);
    await scratch.unsafe(migrationSql);
    assert.equal((await scratch`SELECT * FROM api_keys`).length, 0);
  } finally {
    await scratch.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await scratch.end();
  }
});
