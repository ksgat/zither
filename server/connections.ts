import { z } from 'zod';
import type { Pool } from 'pg';
import { AppError } from '../shared/errors.js';
import { createVault, digest, randomToken } from './security.js';
import { OnshapeClient } from './onshape.js';
import { unavailableKernel, type CadKernel } from './kernel.js';

const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.coerce.number().positive() });
type Tokens = { access: string; refresh: string; expires: number };
type Config = { origin: string; clientId: string; clientSecret: string; encryptionKey: string; apiVersion: string };

export function onshapeConnections(db: Pool, config: Config, fetcher: typeof fetch = fetch, kernel: CadKernel = unavailableKernel) {
  const vault = createVault(config.encryptionKey);
  const callback = `${config.origin}/onshape/callback`;

  async function exchange(values: Record<string, string>, previousRefresh?: string): Promise<Tokens> {
    const response = await fetcher('https://oauth.onshape.com/oauth/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...values, client_id: config.clientId, client_secret: config.clientSecret }),
    });
    if (response.status === 429 || response.status >= 500) throw new AppError('onshape_auth_unavailable', 'Onshape sign-in is temporarily unavailable. Try again shortly.', 503);
    if (!response.ok) throw new AppError('onshape_auth_failed', 'Onshape authorization failed. Reconnect Onshape.', 401);
    const data = tokenSchema.parse(await response.json());
    const refresh = data.refresh_token ?? previousRefresh;
    if (!refresh) throw new AppError('onshape_auth_failed', 'Onshape did not return a refresh token.', 502);
    return { access: data.access_token, refresh, expires: Date.now() + data.expires_in * 1000 };
  }

  async function credentials(userId: string, rejectedAccess?: string): Promise<Tokens> {
    const connection = await db.connect();
    try {
      await connection.query('BEGIN');
      // The row lock serializes refresh across server processes and prevents token rotation races.
      const { rows } = await connection.query('SELECT credentials FROM onshape_connections WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!rows[0]) throw new AppError('not_connected', 'Connect Onshape first.', 409);
      let tokens = vault.open<Tokens>(rows[0].credentials, userId);
      // A concurrent request may already have replaced the rejected token.
      if (tokens.expires < Date.now() + 60_000 || tokens.access === rejectedAccess) {
        tokens = await exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh }, tokens.refresh);
        await connection.query('UPDATE onshape_connections SET credentials=$2, updated_at=now() WHERE user_id=$1', [userId, vault.seal(tokens, userId)]);
      }
      await connection.query('COMMIT');
      return tokens;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }

  return {
    async connected(userId: string) {
      return (await db.query('SELECT 1 FROM onshape_connections WHERE user_id=$1', [userId])).rows.length > 0;
    },
    async start(userId: string) {
      if (!config.clientId || !config.clientSecret) throw new AppError('not_configured', 'The server needs Onshape OAuth credentials.', 503);
      const state = randomToken();
      await db.query('INSERT INTO onshape_oauth_states VALUES ($1, $2, now() + interval \'10 minutes\')', [digest(state), userId]);
      return `${config.origin}/onshape/connect?state=${state}`;
    },
    async authorize(userId: string, state: string) {
      const { rows } = await db.query('SELECT 1 FROM onshape_oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now()', [digest(state), userId]);
      if (!rows[0]) throw new AppError('account_mismatch', 'Sign in with the same Zither account as the desktop app, then reconnect.', 403);
      const url = new URL('https://oauth.onshape.com/oauth/authorize');
      // Permissions are configured in the Onshape application registration.
      url.search = new URLSearchParams({ client_id: config.clientId, response_type: 'code', redirect_uri: callback, state }).toString();
      return url.href;
    },
    async finish(userId: string, state: string, code: string) {
      const { rows } = await db.query('DELETE FROM onshape_oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING user_id', [digest(state), userId]);
      if (!rows[0]) throw new AppError('invalid_state', 'Onshape sign-in expired. Start again from Zither.', 401);
      const tokens = await exchange({ grant_type: 'authorization_code', code, redirect_uri: callback });
      await db.query(`INSERT INTO onshape_connections (user_id, credentials) VALUES ($1,$2)
        ON CONFLICT (user_id) DO UPDATE SET credentials=$2, updated_at=now()`, [userId, vault.seal(tokens, userId)]);
    },
    async disconnect(userId: string) {
      await db.query('DELETE FROM onshape_connections WHERE user_id=$1', [userId]);
      await db.query('DELETE FROM onshape_oauth_states WHERE user_id=$1', [userId]);
    },
    async client(userId: string) {
      const tokens = await credentials(userId);
      return new OnshapeClient(tokens.access, config.apiVersion, fetcher, kernel,
        async rejected => (await credentials(userId, rejected)).access);
    },
  };
}
