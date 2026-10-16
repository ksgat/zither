import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { afterEach, expect, it, vi } from 'vitest';
import { codexLogin } from '../electron/codex.js';
import { apiKeyProviderSchema, migrateModelCredentials, modelConnections } from '../electron/models.js';

const localFetch = globalThis.fetch;
const token = `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url')}.test`;
const credential = { type: 'oauth' as const, access: token, refresh: 'test-refresh', expires: Date.now() + 3_600_000, accountId: 'test-account' };
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const credentials = new InMemoryCredentialStore();
  const providers = modelConnections({ credentials });
  const open = vi.fn(async (_url: string) => {});
  const show = vi.fn((_id: string | null) => {});
  const login = codexLogin(open, show);
  const controller = new AbortController();
  const exchange = vi.fn(async () => Response.json({ access_token: token, refresh_token: 'test-refresh', expires_in: 3600 }));
  vi.stubGlobal('fetch', exchange);
  return { credentials, providers, open, show, login, controller, exchange };
}
async function begin(s: ReturnType<typeof setup>) {
  const result = s.login.run(s.providers.models, AbortSignal.any([s.controller.signal, AbortSignal.timeout(5000)]));
  void result.catch(() => {});
  await vi.waitFor(() => expect(s.show).toHaveBeenCalledWith(expect.any(String)));
  const auth = new URL(s.open.mock.calls[0][0]);
  const callback = new URL(auth.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({ code: 'test-code', state: auth.searchParams.get('state')! }).toString();
  return { result, auth, callback, id: s.show.mock.calls[0][0]! };
}

it('completes Pi browser OAuth with PKCE, keeps credentials separate, and selects the Codex transport', async () => {
  const s = setup();
  await s.credentials.modify('openai', async () => ({ type: 'api_key', key: 'existing-api-key' }));
  const { result, auth, callback, id } = await begin(s);
  try {
    expect((await localFetch(callback)).ok).toBe(true);
    await result;
    const [endpoint, options] = s.exchange.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe('https://auth.openai.com/oauth/token');
    const body = new URLSearchParams(options.body as URLSearchParams);
    expect(body.get('code')).toBe('test-code');
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));
    expect(await s.credentials.read('openai-codex')).toMatchObject({ type: 'oauth', accountId: 'test-account', refresh: 'test-refresh' });
    expect(await s.credentials.read('openai')).toEqual({ type: 'api_key', key: 'existing-api-key' });
    expect(s.show).toHaveBeenLastCalledWith(null);
    expect(() => s.login.reply(id, callback.href)).toThrow('ended');
    const catalog = await s.providers.list();
    const model = catalog.find(m => m.provider === 'openai-codex')!;
    expect(model).toBeDefined();
    expect(s.providers.selected(model.provider, model.id)).toMatchObject({ api: 'openai-codex-responses', baseUrl: 'https://chatgpt.com/backend-api' });
    expect(apiKeyProviderSchema.safeParse('openai-codex').success).toBe(false);
  } finally { s.controller.abort(); await result.catch(() => {}); }
});

it('accepts a pasted callback when the callback port is occupied', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => { occupied.once('error', reject); occupied.listen(1455, '127.0.0.1', resolve); });
  const s = setup();
  try {
    const { result, callback, id } = await begin(s);
    expect(() => s.login.reply('stale-request', callback.href)).toThrow('ended');
    expect(() => s.login.reply(id, 'http://localhost:1455/auth/callback?code=test')).toThrow('full localhost');
    expect(() => s.login.reply(id, 'https://example.com/?code=test&state=test')).toThrow('full localhost');
    s.login.reply(id, callback.href);
    await result;
    expect(await s.credentials.read('openai-codex')).toMatchObject({ type: 'oauth' });
  } finally { s.controller.abort(); await new Promise<void>(resolve => occupied.close(() => resolve())); }
});

it('rejects mismatched OAuth state without exchanging or replacing credentials', async () => {
  const s = setup();
  await s.credentials.modify('openai-codex', async () => credential);
  const { result, callback, id } = await begin(s);
  callback.searchParams.set('state', 'wrong-state');
  s.login.reply(id, callback.href);
  await expect(result).rejects.toThrow('Codex sign-in failed');
  expect(s.exchange).not.toHaveBeenCalled();
  expect(await s.credentials.read('openai-codex')).toEqual(credential);
});

it('cancels a pending prompt and ignores replies from an ended attempt', async () => {
  const s = setup();
  const { result, callback, id } = await begin(s);
  s.controller.abort();
  await expect(result).rejects.toThrow('cancelled');
  expect(s.show).toHaveBeenLastCalledWith(null);
  expect(() => s.login.reply(id, callback.href)).toThrow('ended');
  expect(await s.credentials.read('openai-codex')).toBeUndefined();
  expect(s.exchange).not.toHaveBeenCalled();
});

it('reports browser launch failures and hides token response bodies', async () => {
  const s = setup();
  s.open.mockRejectedValueOnce(new Error('browser failed'));
  await expect(s.login.run(s.providers.models, AbortSignal.timeout(5000))).rejects.toThrow('Could not open Codex sign-in');
  s.open.mockClear(); s.show.mockClear();
  const { result, callback, id } = await begin(s);
  s.exchange.mockResolvedValueOnce(new Response('secret-token-in-response', { status: 400 }));
  s.login.reply(id, callback.href);
  await expect(result).rejects.toThrow(/^Codex sign-in failed\. Please try again\.$/);
});

it('refreshes Codex credentials with Pi and never authenticates OpenAI with retired OAuth credentials', async () => {
  const s = setup();
  await s.credentials.modify('openai-codex', async () => ({ ...credential, expires: 0 }));
  await s.providers.models.getAuth('openai-codex');
  const [, options] = s.exchange.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URLSearchParams(options.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
  expect((await s.credentials.read('openai-codex'))?.type).toBe('oauth');
  await s.credentials.modify('openai', async () => credential);
  s.exchange.mockClear();
  const catalog = await s.providers.list();
  expect(catalog.some(m => m.provider === 'openai-codex')).toBe(true);
  expect(catalog.some(m => m.provider === 'openai')).toBe(false);
  expect(await s.providers.models.getAuth('openai')).toBeUndefined();
  expect(s.exchange).not.toHaveBeenCalled();
});

it.each(['openai', 'openai-codex'])('removes retired credentials and preserves the %s selection when valid', async provider => {
  const s = setup();
  const selection = { provider, id: 'model', name: 'Model' };
  const values = new Map<string, unknown>([['model', selection], ['deviceId', 'retired-device']]);
  const store = { credentials: s.credentials, get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => { values.set(key, value); } };
  await s.credentials.modify('openai', async () => credential);
  await s.credentials.modify('openai-codex', async () => credential);
  await migrateModelCredentials(store);
  expect(await s.credentials.read('openai')).toBeUndefined();
  expect(await s.credentials.read('openai-codex')).toEqual(credential);
  expect(values.get('deviceId')).toBeUndefined();
  expect(values.get('model')).toEqual(provider === 'openai' ? null : selection);
  await s.credentials.modify('openai', async () => ({ type: 'api_key', key: 'existing-api-key' }));
  values.set('model', selection);
  await migrateModelCredentials(store);
  expect(await s.credentials.read('openai')).toEqual({ type: 'api_key', key: 'existing-api-key' });
  expect(values.get('model')).toEqual(selection);
  expect(s.exchange).not.toHaveBeenCalled();
});
