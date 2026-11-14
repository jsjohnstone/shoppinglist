import crypto from 'crypto';

// API keys are long random strings, so a fast hash is enough: there is
// nothing to brute-force, and the server only ever needs to check a key.

export function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key), 'utf8').digest('hex');
}

// Non-secret tail of the key, kept so keys can be told apart in the UI
export function apiKeyLastFour(key) {
  return String(key).slice(-4);
}

// Constant-time comparison of two hex hashes
export function hashesMatch(a, b) {
  const bufferA = Buffer.from(String(a), 'utf8');
  const bufferB = Buffer.from(String(b), 'utf8');
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
}
