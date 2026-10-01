import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import type { OAuthCredential } from '@earendil-works/pi-ai';
import { challenge, loopback, randomToken } from './loopback.js';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1),
  id_token: z.string().optional(), expires_in: z.number().positive(), scope: z.string(), token_type: z.literal('Bearer') });

async function tokens(body: Record<string, string>, signal: AbortSignal) {
  const response = await fetch(`${issuer}/api/accounts/oauth/token`, { method: 'POST', redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, resource }) });
  if (!response.ok) throw new Error('ChatGPT authorization failed. Sign in again.');
  const result = tokenSchema.parse(await response.json());
  if (!result.scope.split(' ').includes('chatgpt.tokens.use.direct')) throw new Error('ChatGPT plan usage was not granted. Enable it during sign-in.');
  return result;
}
export async function verifyIdentity(idToken: string, clientId: string, nonce?: string, subject?: string, jwks = keys) {
  const { payload } = await jwtVerify(idToken, jwks, { issuer, audience: clientId, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'] });
  if (!payload.sub || (nonce && payload.nonce !== nonce) || (subject && payload.sub !== subject)) throw new Error('ChatGPT account could not be verified.');
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}
export async function loginChatGPT(deviceId: string, open: (url: string) => Promise<void>, signal: AbortSignal, previous?: OAuthCredential): Promise<OAuthCredential> {
  const state = randomToken(), verifier = randomToken(), nonce = randomToken();
  const callback = await loopback(state, signal, '/auth/callback');
  try {
    const existingId = typeof previous?.clientId === 'string' ? previous.clientId : undefined;
    const url = new URL(`${issuer}/api/accounts/authorize`);
    url.search = new URLSearchParams({ client_id: existingId ?? 'dynamic_agent_client',
      ...(existingId ? {} : { agent_name_hint: 'Zither' }),
      ...(existingId && typeof previous?.idToken === 'string' ? { id_token_hint: previous.idToken } : {}),
      ext_agent_host_id: `urn:uuid:${deviceId}`, response_type: 'code', redirect_uri: callback.redirectUri,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource,
      state, nonce, code_challenge: challenge(verifier), code_challenge_method: 'S256' }).toString();
    await open(url.href);
    const returned = await callback.result;
    const returnedId = returned.searchParams.get('client_id');
    if (existingId && returnedId && existingId !== returnedId) throw new Error('ChatGPT returned a different client registration.');
    const clientId = existingId ?? returnedId;
    if (!clientId || clientId === 'dynamic_agent_client') throw new Error('ChatGPT registration did not complete.');
    const result = await tokens({ grant_type: 'authorization_code', client_id: clientId,
      code: returned.searchParams.get('code')!, code_verifier: verifier, redirect_uri: callback.redirectUri }, signal);
    if (!result.id_token) throw new Error('ChatGPT did not return an identity token.');
    const identity = await verifyIdentity(result.id_token, clientId, nonce, previous?.subject as string | undefined);
    return { type: 'oauth', clientId, ...identity, idToken: result.id_token,
      access: result.access_token, refresh: result.refresh_token, expires: Date.now() + result.expires_in * 1000 - 60_000,
      scopes: result.scope.split(' ') };
  } finally { callback.close(); }
}
export async function refreshChatGPT(credential: OAuthCredential, signal: AbortSignal): Promise<OAuthCredential> {
  const clientId = z.string().min(1).parse(credential.clientId);
  const result = await tokens({ grant_type: 'refresh_token', client_id: clientId, refresh_token: credential.refresh }, signal);
  if (result.id_token) await verifyIdentity(result.id_token, clientId, undefined, z.string().min(1).parse(credential.subject));
  return { ...credential, access: result.access_token, refresh: result.refresh_token,
    idToken: result.id_token ?? credential.idToken, scopes: result.scope.split(' '), expires: Date.now() + result.expires_in * 1000 - 60_000 };
}
