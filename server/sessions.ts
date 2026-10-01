import { z } from 'zod';
import type { Pool } from 'pg';
import { AppError } from '../shared/errors.js';
import { digest, loopbackRedirect, randomToken } from './security.js';

export const handoffSchema = z.object({
  redirectUri: z.string().transform(loopbackRedirect),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const exchangeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  redirectUri: z.string().transform(loopbackRedirect),
}).strict();

export function desktopSessions(db: Pick<Pool, 'query'>) {
  return {
    async authorize(userId: string, input: unknown) {
      const { redirectUri, challenge, state } = handoffSchema.parse(input);
      const code = randomToken();
      await db.query('INSERT INTO desktop_grants VALUES ($1, $2, $3, $4, now() + interval \'2 minutes\')',
        [digest(code), userId, challenge, redirectUri]);
      const callback = new URL(redirectUri);
      callback.search = new URLSearchParams({ code, state }).toString();
      return callback.href;
    },
    async exchange(input: unknown) {
      const { code, verifier, redirectUri } = exchangeSchema.parse(input);
      const { rows } = await db.query(`DELETE FROM desktop_grants WHERE code_hash=$1 AND challenge=$2
        AND redirect_uri=$3 AND expires_at > now() RETURNING user_id`, [digest(code), digest(verifier), redirectUri]);
      if (!rows[0]) throw new AppError('invalid_grant', 'This sign-in link has expired or was already used.', 401);
      const token = randomToken();
      await db.query('INSERT INTO desktop_sessions VALUES ($1, $2, now() + interval \'30 days\')', [digest(token), rows[0].user_id]);
      return { token };
    },
    async user(authorization = '') {
      if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) throw new AppError('unauthorized', 'Sign in to Zither.', 401);
      const { rows } = await db.query(`SELECT u.id, u.name, u.email FROM desktop_sessions s
        JOIN "user" u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(authorization.slice(7))]);
      if (!rows[0]) throw new AppError('unauthorized', 'Your Zither session expired. Sign in again.', 401);
      return rows[0] as { id: string; name: string; email: string };
    },
    async revoke(authorization: string) {
      await db.query('DELETE FROM desktop_sessions WHERE token_hash=$1', [digest(authorization.slice(7))]);
    },
  };
}
