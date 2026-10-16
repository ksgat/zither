import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { auth, db as runtimeDb } from './auth.js';
import { config } from './config.js';

const checking = process.argv.includes('--check');
const db = new pg.Pool({ connectionString: config.DATABASE_MIGRATION_URL || config.DATABASE_URL,
  max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 });
try {
  await db.query('SELECT 1');
  const migration = await getMigrations({ ...auth.options, database: db });
  console.log(`Database connected. Auth schema: ${migration.toBeCreated.length} tables, ${migration.toBeAdded.length} table updates, ${migration.toBeAddedIndexes.length} indexes pending.`);
  if (migration.schemaProblems.length || migration.unsafeChanges.length) {
    throw new Error('Existing auth schema needs manual review before migration.');
  }
  if (checking) {
    const { rows } = await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,
    [['desktop_grants', 'desktop_sessions', 'onshape_oauth_states', 'onshape_connections']]);
    const pending = migration.toBeCreated.length + migration.toBeAdded.length + migration.toBeAddedIndexes.length || rows.length !== 4;
    console.log(pending ? 'Run npm run db:migrate to create the missing schema.' : 'Zither database schema is ready.');
    if (pending) process.exitCode = 1;
  } else {
    await migration.runMigrations();
    await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    console.log('Zither database is ready.');
  }
} catch {
  // Driver errors can contain connection details; never print the connection string.
  console.error('Database setup failed. Check the Neon connection string, SSL settings, database permissions, and existing schema.');
  process.exitCode = 1;
} finally { await db.end(); await runtimeDb.end(); }
