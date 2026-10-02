import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { onshapeConnections } from '../server/connections.js';
import { createVault } from '../server/security.js';

const postgres = new PGlite();
const config = { origin: 'http://localhost:3001', clientId: 'test-client', clientSecret: 'test-secret',
  encryptionKey: Buffer.alloc(32, 2).toString('base64'), apiVersion: 'v17' };
const vault = createVault(config.encryptionKey);
beforeAll(() => postgres.exec('CREATE TABLE onshape_connections (user_id text PRIMARY KEY, credentials text NOT NULL, updated_at timestamptz DEFAULT now())'));
afterAll(() => postgres.close());
// PGlite has one connection. Queue transactions to model the production row lock.
let available = Promise.resolve();
const db = { async connect() {
  const previous = available;
  let release!: () => void;
  available = new Promise<void>(resolve => { release = resolve; });
  await previous;
  return { query: (sql: string, params: unknown[] = []) => postgres.query(sql, params), release };
} } as unknown as Pool;
const search = { query: '', filter: 'all' as const, offset: 0 };
async function seed(expired = false) {
  await postgres.query('DELETE FROM onshape_connections');
  await postgres.query('INSERT INTO onshape_connections (user_id, credentials) VALUES ($1,$2)', ['alice',
    vault.seal({ access: 'old-access', refresh: 'old-refresh', expires: Date.now() + (expired ? -1 : 3600_000) }, 'alice')]);
}
async function stored() {
  const { rows } = await postgres.query<{ credentials: string }>('SELECT credentials FROM onshape_connections WHERE user_id=$1', ['alice']);
  return vault.open<{ access: string; refresh: string }>(rows[0].credentials, 'alice');
}

it('recovers concurrent early 401s with one serialized token rotation and persists both tokens', async () => {
  await seed();
  const exchange = vi.fn().mockImplementation(() => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url) === 'https://oauth.onshape.com/oauth/token') {
      expect(new URLSearchParams(init!.body as URLSearchParams).get('refresh_token')).toBe('old-refresh');
      return exchange();
    }
    return new Headers(init!.headers).get('Authorization') === 'Bearer new-access'
      ? Response.json({ items: [], next: null }) : Response.json({ error: 'invalid_token' }, { status: 401 });
  });
  const connections = onshapeConnections(db, config, fetcher);
  const clients = await Promise.all([connections.client('alice'), connections.client('alice')]);
  expect(await Promise.all(clients.map(client => client.documents(search)))).toEqual([
    { items: [], nextOffset: null }, { items: [], nextOffset: null },
  ]);
  expect(exchange).toHaveBeenCalledTimes(1);
  expect(await stored()).toMatchObject({ access: 'new-access', refresh: 'new-refresh' });
  await (await connections.client('alice')).documents(search);
  expect(exchange).toHaveBeenCalledTimes(1);
});
it('refreshes expired tokens before reading and retains a refresh token when rotation is omitted', async () => {
  await seed(true);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ access_token: 'new-access', expires_in: 3600 }))
    .mockResolvedValueOnce(Response.json({ items: [], next: null }));
  const client = await onshapeConnections(db, config, fetcher).client('alice');
  await client.documents(search);
  expect(fetcher.mock.calls[0][0]).toBe('https://oauth.onshape.com/oauth/token');
  expect(new Headers(fetcher.mock.calls[1][1]!.headers).get('Authorization')).toBe('Bearer new-access');
  expect(await stored()).toMatchObject({ access: 'new-access', refresh: 'old-refresh' });
});
it.each([[400, 'onshape_auth_failed'], [503, 'onshape_auth_unavailable']] as const)('preserves credentials when token exchange returns %s', async (status, code) => {
  await seed();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({}, { status: 401 }))
    .mockResolvedValueOnce(Response.json({}, { status }));
  const client = await onshapeConnections(db, config, fetcher).client('alice');
  await expect(client.documents(search)).rejects.toMatchObject({ code });
  expect(await stored()).toMatchObject({ access: 'old-access', refresh: 'old-refresh' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
