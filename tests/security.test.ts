import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { createVault, loopbackRedirect } from '../server/security.js';

it('binds encrypted credentials to their owner and detects tampering', () => {
  const vault = createVault(randomBytes(32).toString('base64'));
  const sealed = vault.seal({ access: 'secret' }, 'alice');
  expect(vault.open(sealed, 'alice')).toEqual({ access: 'secret' });
  expect(() => vault.open(sealed, 'bob')).toThrow();
  const damaged = Buffer.from(sealed, 'base64'); damaged[30] ^= 1;
  expect(() => vault.open(damaged.toString('base64'), 'alice')).toThrow();
});

it.each(['https://evil.com/callback', 'http://localhost:3000/callback', 'http://127.0.0.1:80/callback',
  'http://127.0.0.1:5000/callback?next=evil', 'http://user@127.0.0.1:5000/callback'])('rejects unsafe callback %s', value => {
  expect(() => loopbackRedirect(value)).toThrow();
});
it('accepts a desktop loopback callback', () => expect(loopbackRedirect('http://127.0.0.1:54321/callback')).toBe('http://127.0.0.1:54321/callback'));
