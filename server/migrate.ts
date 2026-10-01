import { readFile } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { auth, db } from './auth.js';

try {
  const migration = await getMigrations(auth.options);
  await migration.runMigrations();
  await db.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  console.log('Zither database is ready.');
} finally { await db.end(); }
