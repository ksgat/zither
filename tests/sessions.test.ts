import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { desktopSessions } from '../server/sessions.js';
import { digest, randomToken } from '../server/security.js';

const db = new PGlite();
const sessions = desktopSessions(db as unknown as Pick<Pool, 'query'>);
const redirectUri = 'http://127.0.0.1:54321/callback';
beforeAll(async () => {
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY, name text, email text)');
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO "user" VALUES ($1,$2,$3)', ['alice', 'Alice', 'alice@example.test']);
}, 30_000);
afterAll(() => db.close());

async function grant() {
  const verifier = randomToken(), state = randomToken();
  const callback = new URL(await sessions.authorize('alice', { redirectUri, challenge: digest(verifier), state }));
  expect(callback.searchParams.get('state')).toBe(state);
  return { code: callback.searchParams.get('code')!, verifier, redirectUri };
}
describe('desktop sign-in with Postgres', () => {
  it('exchanges a PKCE grant once, authenticates, and revokes the desktop session', async () => {
    const input = await grant();
    const { token } = await sessions.exchange(input);
    expect(await sessions.user(`Bearer ${token}`)).toMatchObject({ id: 'alice' });
    await expect(sessions.exchange(input)).rejects.toMatchObject({ code: 'invalid_grant' });
    await sessions.revoke(`Bearer ${token}`);
    await expect(sessions.user(`Bearer ${token}`)).rejects.toMatchObject({ code: 'unauthorized' });
  });
  it('does not consume a grant when the verifier or callback is wrong', async () => {
    const input = await grant();
    await expect(sessions.exchange({ ...input, verifier: randomToken() })).rejects.toThrow();
    await expect(sessions.exchange({ ...input, redirectUri: 'http://127.0.0.1:54322/callback' })).rejects.toThrow();
    expect(await sessions.exchange(input)).toHaveProperty('token');
  });
  it('rejects expired grants and sessions', async () => {
    const input = await grant();
    await db.query('UPDATE desktop_grants SET expires_at=now()-interval \'1 second\' WHERE code_hash=$1', [digest(input.code)]);
    await expect(sessions.exchange(input)).rejects.toThrow();
    const { token } = await sessions.exchange(await grant());
    await db.query('UPDATE desktop_sessions SET expires_at=now()-interval \'1 second\'');
    await expect(sessions.user(`Bearer ${token}`)).rejects.toThrow();
  });
  it('stores only hashes of desktop tokens', async () => {
    const { token } = await sessions.exchange(await grant());
    const result = await db.query<{ token_hash: string }>('SELECT token_hash FROM desktop_sessions');
    expect(result.rows.some(row => row.token_hash === token)).toBe(false);
    expect(result.rows.some(row => row.token_hash === digest(token))).toBe(true);
  });
});
