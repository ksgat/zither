import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
function valid() {
  vi.stubEnv('DATABASE_URL', 'postgresql://user:secret@localhost/test');
  vi.stubEnv('DATABASE_MIGRATION_URL', '');
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3001');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-at-least-32-characters');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 1).toString('base64'));
  for (const provider of ['GOOGLE', 'GITHUB', 'ONSHAPE']) {
    vi.stubEnv(`${provider}_CLIENT_ID`, ''); vi.stubEnv(`${provider}_CLIENT_SECRET`, '');
  }
}
it('allows local password sign-in before optional OAuth providers are configured', async () => {
  valid();
  const { config } = await import('../server/config.js');
  expect(config.DATABASE_MIGRATION_URL).toBe('');
  expect(config.GOOGLE_CLIENT_ID).toBe('');
});
it('reports invalid environment variable names without echoing their secret values', async () => {
  valid(); vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'private-invalid-value');
  await expect(import('../server/config.js')).rejects.toThrow(/^Check .env: TOKEN_ENCRYPTION_KEY\./);
});
it('rejects incomplete OAuth provider settings before serving a broken login button', async () => {
  valid(); vi.stubEnv('GOOGLE_CLIENT_ID', 'client');
  await expect(import('../server/config.js')).rejects.toThrow('Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
});
