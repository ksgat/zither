import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { getMigrations } from 'better-auth/db/migration';
import { afterAll, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ postgres: undefined as PGlite | undefined }));
vi.mock('../server/config.js', () => ({ config: {
  DATABASE_URL: 'postgresql://unused/test', BETTER_AUTH_URL: 'http://localhost:3001',
  BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters',
} }));
// Keep Better Auth's real Postgres adapter and SQL; replace only the network pool.
vi.mock('pg', () => ({ default: { Pool: class {
  on() {}
  async end() {}
  async connect() { return { query: this.query, release() {} }; }
  async query(sql: string, parameters: unknown[] = []) {
    const result = parameters.length ? await state.postgres!.query(sql, parameters) : (await state.postgres!.exec(sql)).at(-1)!;
    return { ...result, rowCount: result.affectedRows, command: sql.trim().split(/\s/)[0].toUpperCase() };
  }
} } }));
state.postgres = new PGlite();
afterAll(() => state.postgres!.close());

it('migrates an empty Postgres database, signs up and signs in, and preserves accounts on rerun', async () => {
  const { auth, db } = await import('../server/auth.js');
  const migration = await getMigrations(auth.options);
  expect(migration.toBeCreated.map(table => table.table)).toEqual(expect.arrayContaining(['user', 'session', 'account', 'verification', 'rateLimit']));
  expect(migration.schemaProblems).toEqual([]);
  await migration.runMigrations();
  const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
  await db.query(schema);
  const signup = await auth.api.signUpEmail({ body: { name: 'Test user', username: 'zither_test', email: 'zither@example.test', password: 'a-test-password-123' } });
  expect(signup.user.id).toBeTruthy();
  const login = await auth.api.signInUsername({ body: { username: 'zither_test', password: 'a-test-password-123' } });
  expect(login.user.id).toBe(signup.user.id);
  const rerun = await getMigrations(auth.options);
  expect(rerun.toBeCreated).toEqual([]);
  expect(rerun.toBeAdded).toEqual([]);
  expect(rerun.toBeAddedIndexes).toEqual([]);
  await rerun.runMigrations();
  await db.query(schema);
  const { rows } = await db.query('SELECT id FROM "user"');
  expect(rows).toEqual([{ id: signup.user.id }]);
  const tables = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
  expect(tables.rows.map(row => row.table_name)).toEqual(expect.arrayContaining(['desktop_grants', 'desktop_sessions', 'onshape_oauth_states', 'onshape_connections']));
}, 30_000);
