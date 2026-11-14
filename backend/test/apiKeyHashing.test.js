import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashApiKey, apiKeyLastFour, hashesMatch } from '../services/apiKeys.js';

test('hashApiKey is SHA-256 in hex', () => {
  // Published SHA-256 test vector for "abc"
  assert.equal(
    hashApiKey('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(hashApiKey('abc'), hashApiKey('abc'));
  assert.notEqual(hashApiKey('abc'), hashApiKey('abd'));
});

test('apiKeyLastFour keeps only the tail of the key', () => {
  assert.equal(apiKeyLastFour('0123456789abcdef'), 'cdef');
  assert.equal(apiKeyLastFour('abc'), 'abc');
});

test('hashesMatch compares hashes without throwing on length differences', () => {
  const hash = hashApiKey('abc');
  assert.equal(hashesMatch(hash, hashApiKey('abc')), true);
  assert.equal(hashesMatch(hash, hashApiKey('abd')), false);
  assert.equal(hashesMatch(hash, 'short'), false);
});
