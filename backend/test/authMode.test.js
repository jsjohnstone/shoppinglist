import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getAuthMode } from '../middleware/auth.js';

const saved = { AUTH_MODE: process.env.AUTH_MODE, DISABLE_AUTH: process.env.DISABLE_AUTH };

function setEnv(authMode, disableAuth) {
  for (const [key, value] of [['AUTH_MODE', authMode], ['DISABLE_AUTH', disableAuth]]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => setEnv(saved.AUTH_MODE, saved.DISABLE_AUTH));

test('login is required for everything by default', () => {
  setEnv(undefined, undefined);
  assert.equal(getAuthMode(), 'full');
  setEnv(undefined, 'false');
  assert.equal(getAuthMode(), 'full');
});

test('DISABLE_AUTH=true still means no login at all', () => {
  setEnv(undefined, 'true');
  assert.equal(getAuthMode(), 'none');
});

test('AUTH_MODE selects the mode and wins over DISABLE_AUTH', () => {
  setEnv('admin', undefined);
  assert.equal(getAuthMode(), 'admin');
  setEnv(' Admin ', 'true');
  assert.equal(getAuthMode(), 'admin');
  setEnv('none', 'false');
  assert.equal(getAuthMode(), 'none');
  setEnv('full', 'true');
  assert.equal(getAuthMode(), 'full');
});

test('an unrecognised AUTH_MODE falls back to requiring login', () => {
  setEnv('open', 'true');
  assert.equal(getAuthMode(), 'full');
});
