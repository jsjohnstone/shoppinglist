// Name-based item matching for API-key clients (e.g. voice assistants) that
// do not know item ids. Pure functions - no database access.

// Lowercase, strip punctuation and collapse whitespace
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Very small plural stemmer: "eggs" -> "egg", "tomatoes" -> "tomato", "berries" -> "berry"
function stemWord(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(oes|ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function stemTokens(normalized) {
  return normalized.split(' ').filter(Boolean).map(stemWord);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

// Allowed typo distance: none for short names (too many real words are one
// letter apart, e.g. "beer"/"beef"), 1 up to 9 chars, 2 beyond
function allowedDistance(length) {
  if (length < 5) return 0;
  if (length < 10) return 1;
  return 2;
}

/**
 * Match a spoken/typed name against a set of candidate items.
 *
 * Tiers are tried in order and the first tier with any hit decides the result:
 *   1. exact    - same name ignoring case, punctuation and extra whitespace
 *   2. plural   - same name ignoring singular/plural ("egg" vs "eggs")
 *   3. partial  - every word of the query appears in the item name, or the
 *                 other way round ("milk" vs "semi skimmed milk")
 *   4. fuzzy    - small typo distance ("brocoli" vs "broccoli")
 *
 * Returns one of:
 *   { result: 'matched', matchType, item }
 *   { result: 'ambiguous', matchType, candidates }
 *   { result: 'not_found' }
 *
 * More than one hit within the deciding tier is always 'ambiguous'.
 */
export function matchItemByName(query, candidateItems) {
  const normalizedQuery = normalizeName(query);
  if (!normalizedQuery) {
    return { result: 'not_found' };
  }

  const queryTokens = stemTokens(normalizedQuery);
  const queryStemmed = queryTokens.join(' ');

  const prepared = candidateItems.map(item => {
    const normalized = normalizeName(item.name);
    const tokens = stemTokens(normalized);
    return { item, normalized, tokens, stemmed: tokens.join(' ') };
  }).filter(entry => entry.normalized);

  const tiers = [
    ['exact', entry => entry.normalized === normalizedQuery],
    ['plural', entry => entry.stemmed === queryStemmed],
    ['partial', entry =>
      queryTokens.every(token => entry.tokens.includes(token)) ||
      entry.tokens.every(token => queryTokens.includes(token))],
    ['fuzzy', entry => {
      const allowed = allowedDistance(Math.min(queryStemmed.length, entry.stemmed.length));
      return allowed > 0 && levenshtein(queryStemmed, entry.stemmed) <= allowed;
    }],
  ];

  for (const [matchType, predicate] of tiers) {
    const hits = prepared.filter(predicate).map(entry => entry.item);
    if (hits.length === 1) {
      return { result: 'matched', matchType, item: hits[0] };
    }
    if (hits.length > 1) {
      return { result: 'ambiguous', matchType, candidates: hits };
    }
  }

  return { result: 'not_found' };
}
