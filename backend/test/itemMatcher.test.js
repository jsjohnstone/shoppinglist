import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchItemByName, normalizeName } from '../services/itemMatcher.js';

const item = (id, name) => ({ id, name });

test('normalizeName ignores case, punctuation and extra whitespace', () => {
  assert.equal(normalizeName('  Semi-Skimmed   MILK! '), 'semi skimmed milk');
  assert.equal(normalizeName("Baker's Yeast"), 'bakers yeast');
  assert.equal(normalizeName('Crème fraîche'), 'creme fraiche');
  assert.equal(normalizeName(null), '');
});

test('exact match is case-insensitive and wins over partial matches', () => {
  const result = matchItemByName('MILK', [item(1, 'Milk'), item(2, 'Oat milk'), item(3, 'Milk chocolate')]);
  assert.equal(result.result, 'matched');
  assert.equal(result.matchType, 'exact');
  assert.equal(result.item.id, 1);
});

test('duplicate exact names are ambiguous', () => {
  const result = matchItemByName('milk', [item(1, 'Milk'), item(2, 'milk')]);
  assert.equal(result.result, 'ambiguous');
  assert.equal(result.matchType, 'exact');
  assert.deepEqual(result.candidates.map(c => c.id), [1, 2]);
});

test('singular and plural forms match', () => {
  assert.equal(matchItemByName('egg', [item(1, 'Eggs'), item(2, 'Bread')]).item.id, 1);
  assert.equal(matchItemByName('tomatoes', [item(1, 'Tomato')]).item.id, 1);
  assert.equal(matchItemByName('strawberry', [item(1, 'Strawberries')]).item.id, 1);
  assert.equal(matchItemByName('eggs', [item(1, 'Eggs')]).matchType, 'exact');
  assert.equal(matchItemByName('egg', [item(1, 'Eggs')]).matchType, 'plural');
});

test('a single partial match is accepted', () => {
  const result = matchItemByName('milk', [item(1, 'Semi skimmed milk'), item(2, 'Bread')]);
  assert.equal(result.result, 'matched');
  assert.equal(result.matchType, 'partial');
  assert.equal(result.item.id, 1);
});

test('a longer spoken phrase matches a shorter item name', () => {
  const result = matchItemByName('the semi skimmed milk', [item(1, 'Milk'), item(2, 'Bread')]);
  assert.equal(result.result, 'matched');
  assert.equal(result.item.id, 1);
});

test('partial matching works on whole words only', () => {
  assert.equal(matchItemByName('ham', [item(1, 'Shampoo')]).result, 'not_found');
  assert.equal(matchItemByName('rice', [item(1, 'Licorice')]).result, 'not_found');
});

test('several partial matches are ambiguous and list the candidates', () => {
  const result = matchItemByName('milk', [item(1, 'Oat milk'), item(2, 'Semi skimmed milk'), item(3, 'Bread')]);
  assert.equal(result.result, 'ambiguous');
  assert.equal(result.matchType, 'partial');
  assert.deepEqual(result.candidates.map(c => c.name), ['Oat milk', 'Semi skimmed milk']);
});

test('small typos match, large differences do not', () => {
  const result = matchItemByName('brocoli', [item(1, 'Broccoli'), item(2, 'Bread')]);
  assert.equal(result.result, 'matched');
  assert.equal(result.matchType, 'fuzzy');
  assert.equal(result.item.id, 1);

  assert.equal(matchItemByName('cheese', [item(1, 'Chicken')]).result, 'not_found');
  // Short names never fuzzy-match
  assert.equal(matchItemByName('tea', [item(1, 'Pea')]).result, 'not_found');
  assert.equal(matchItemByName('beer', [item(1, 'Beef')]).result, 'not_found');
});

test('nothing matching is not_found', () => {
  assert.equal(matchItemByName('caviar', [item(1, 'Milk'), item(2, 'Bread')]).result, 'not_found');
  assert.equal(matchItemByName('milk', []).result, 'not_found');
  assert.equal(matchItemByName('   ', [item(1, 'Milk')]).result, 'not_found');
});
