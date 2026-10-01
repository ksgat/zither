import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { verifyIdentity } from '../electron/chatgpt.js';

it('validates identity signature, audience, nonce, and returning account', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [await exportJWK(publicKey)] });
  const token = await new SignJWT({ nonce: 'nonce', email: 'a@example.test' }).setProtectedHeader({ alg: 'RS256' })
    .setSubject('alice').setIssuer('https://auth.openai.com').setAudience('client').setIssuedAt().setExpirationTime('2m').sign(privateKey);
  // Local and remote JWKS getters share the same JWT verification contract.
  const keyset = jwks as Parameters<typeof verifyIdentity>[4];
  expect(await verifyIdentity(token, 'client', 'nonce', 'alice', keyset)).toMatchObject({ subject: 'alice' });
  await expect(verifyIdentity(token, 'other-client', 'nonce', 'alice', keyset)).rejects.toThrow();
  await expect(verifyIdentity(token, 'client', 'wrong', 'alice', keyset)).rejects.toThrow();
  await expect(verifyIdentity(token, 'client', 'nonce', 'bob', keyset)).rejects.toThrow();
});
