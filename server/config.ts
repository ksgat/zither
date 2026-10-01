import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  BETTER_AUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  ONSHAPE_CLIENT_ID: z.string().default(''),
  ONSHAPE_CLIENT_SECRET: z.string().default(''),
  ONSHAPE_API_VERSION: z.literal('v17').default('v17'),
  ZITHER_KERNEL_PATH: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
});
export const config = schema.parse(process.env);
const origin = new URL(config.BETTER_AUTH_URL);
if (origin.origin !== config.BETTER_AUTH_URL ||
  (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
  throw new Error('BETTER_AUTH_URL must be an HTTPS origin (HTTP is allowed only on localhost).');
}
