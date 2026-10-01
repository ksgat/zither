import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import pg from 'pg';
import { config } from './config.js';

export const db = new pg.Pool({ connectionString: config.DATABASE_URL, max: 8 });
export const auth = betterAuth({
  appName: 'Zither',
  baseURL: config.BETTER_AUTH_URL,
  secret: config.BETTER_AUTH_SECRET,
  database: db,
  trustedOrigins: [config.BETTER_AUTH_URL],
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  socialProviders: {
    ...(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET },
    } : {}),
    ...(config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET ? {
      github: { clientId: config.GITHUB_CLIENT_ID, clientSecret: config.GITHUB_CLIENT_SECRET },
    } : {}),
  },
  account: { accountLinking: { enabled: false } },
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [username()],
});
