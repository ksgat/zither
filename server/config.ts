import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url().refine(value => /^postgres(ql)?:\/\//.test(value), 'Use a Postgres connection string.'),
  DATABASE_MIGRATION_URL: z.union([z.literal(''), z.string().url().refine(value => /^postgres(ql)?:\/\//.test(value))]).default(''),
  BETTER_AUTH_URL: z.string().url().default('http://localhost:3001'),
  BETTER_AUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().refine(value => Buffer.from(value, 'base64').length === 32, 'Use a base64-encoded 32-byte key.'),
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
const result = schema.safeParse(process.env);
if (!result.success) throw new Error(`Check .env: ${[...new Set(result.error.issues.map(issue => issue.path[0]))].join(', ')}. Run npm run setup for a new configuration.`);
export const config = result.data;
for (const provider of ['GOOGLE', 'GITHUB', 'ONSHAPE'] as const) {
  if (!!config[`${provider}_CLIENT_ID`] !== !!config[`${provider}_CLIENT_SECRET`]) {
    throw new Error(`Set both ${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET in .env, or leave both blank.`);
  }
}
const origin = new URL(config.BETTER_AUTH_URL);
if (origin.origin !== config.BETTER_AUTH_URL ||
  (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
  throw new Error('BETTER_AUTH_URL must be an HTTPS origin (HTTP is allowed only on localhost).');
}
