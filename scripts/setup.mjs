import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template
  .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64url')}`)
  .replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`);
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with local app secrets. Add DATABASE_URL from Neon, then run npm run db:check and npm run db:migrate.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env already exists; kept all existing values.');
}
