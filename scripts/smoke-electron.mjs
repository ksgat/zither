import { _electron as electron } from 'playwright';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('.local', { recursive: true });
const profile = await mkdtemp(resolve('.local/smoke-'));
const desktopEnv = { ...process.env };
delete desktopEnv.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env: { ...desktopEnv, ZITHER_SMOKE_DATA: profile } });
try {
  const window = await app.firstWindow();
  const errors = [];
  window.on('pageerror', error => errors.push(error.message));
  await window.getByRole('heading', { name: 'Documents', exact: true }).waitFor();
  assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await window.evaluate(() => typeof window.zither), 'object');
  assert.equal(await window.evaluate(() => typeof window.zither.loginChatGPT), 'undefined');
  assert.equal(await window.getByRole('button', { name: /ChatGPT/ }).count(), 0);
  const state = await window.evaluate(() => window.zither.state());
  assert.equal(state.user, null);
  assert.equal(state.target, null);
  assert.equal(state.document, null);
  assert.equal(await window.getByRole('button', { name: 'Send message' }).count(), 0);
  assert.equal(await window.getByRole('log', { name: 'Conversation' }).count(), 0);
  await window.evaluate(() => window.zither.saveKey('anthropic', 'smoke-test-not-a-real-key'));
  const encrypted = await readFile(resolve(profile, 'credentials.bin'));
  assert.equal(encrypted.includes(Buffer.from('smoke-test-not-a-real-key')), false);
  assert.ok((await window.evaluate(() => window.zither.models())).length > 0);
  await window.evaluate(() => window.zither.removeProvider('anthropic'));
  await assert.rejects(window.evaluate(() => window.zither.saveKey('openai-codex', 'not-an-oauth-token')));
  // Exercise the actual Pi flow and IPC form without opening a browser or contacting OpenAI.
  await app.evaluate(({ shell }) => {
    const openExternal = shell.openExternal, fetch = globalThis.fetch;
    globalThis.codexTest = { restore: () => { shell.openExternal = openExternal; globalThis.fetch = fetch; } };
    shell.openExternal = async url => { globalThis.codexTest.url = url; };
    globalThis.fetch = async (url, options) => {
      if (String(url) !== 'https://auth.openai.com/oauth/token') return fetch(url, options);
      const token = `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'smoke-account' } })).toString('base64url')}.test`;
      return Response.json({ access_token: token, refresh_token: 'smoke-refresh-token', expires_in: 3600 });
    };
  });
  const signIn = window.getByRole('button', { name: 'Sign in to Codex' });
  await signIn.click();
  await window.getByText('Browser didn’t return?').waitFor();
  await window.getByRole('button', { name: 'Stop', exact: true }).click();
  await window.getByText('Browser didn’t return?').waitFor({ state: 'detached' });
  await signIn.click();
  await window.getByText('Browser didn’t return?').click();
  const callback = await app.evaluate(() => {
    const auth = new URL(globalThis.codexTest.url);
    const url = new URL(auth.searchParams.get('redirect_uri'));
    url.search = new URLSearchParams({ code: 'smoke-code', state: auth.searchParams.get('state') }).toString();
    return url.href;
  });
  await window.getByLabel('Callback link').fill(callback);
  await window.getByRole('button', { name: 'Finish sign-in', exact: true }).click();
  await window.locator('.connection').filter({ hasText: 'openai-codex' }).waitFor();
  const codex = (await window.evaluate(() => window.zither.models())).find(model => model.provider === 'openai-codex');
  assert.ok(codex);
  await window.getByLabel('Model', { exact: true }).selectOption(`openai-codex/${codex.id}`);
  assert.equal((await window.evaluate(() => window.zither.state())).model.provider, 'openai-codex');
  assert.equal((await readFile(resolve(profile, 'credentials.bin'))).includes(Buffer.from('smoke-refresh-token')), false);
  await window.evaluate(() => window.zither.removeProvider('openai-codex'));
  assert.equal((await window.evaluate(() => window.zither.state())).model, null);
  await app.evaluate(() => { globalThis.codexTest.restore(); delete globalThis.codexTest; });
  // Browse through the real renderer, preload, main process, and HTTP client.
  // Only the server's responses and the external browser handoff are simulated.
  await app.evaluate(({ shell }) => {
    const openExternal = shell.openExternal, originalFetch = globalThis.fetch;
    const documentId = 'a'.repeat(24), workspaceId = 'b'.repeat(24), base = 'c'.repeat(24), cover = 'd'.repeat(24);
    const elements = [{ id: base, name: 'Base', elementType: 'PARTSTUDIO' }, { id: cover, name: 'Cover', elementType: 'PARTSTUDIO' },
      { id: 'e'.repeat(24), name: 'Drawing', elementType: 'DRAWING' }];
    globalThis.documentTest = { requests: [], restore: () => { shell.openExternal = openExternal; globalThis.fetch = originalFetch; } };
    globalThis.fetch = async (url, options) => {
      const request = new URL(String(url));
      if (request.origin !== 'http://localhost:3001') throw new Error('Unexpected smoke-test network request');
      const body = options?.body ? JSON.parse(options.body) : null;
      globalThis.documentTest.requests.push({ path: request.pathname, body });
      switch (request.pathname) {
        case '/desktop/exchange': return Response.json({ token: 'smoke-desktop-token' });
        case '/api/session': return Response.json({ user: { name: 'Test user', email: 'test@example.test' }, onshapeConnected: true });
        case '/api/cad/documents': return Response.json(body.query
          ? { items: [{ id: documentId, name: 'Search result' }], nextOffset: null }
          : body.offset ? { items: [{ id: 'f'.repeat(24), name: 'Gearbox' }], nextOffset: null }
          : { items: [{ id: documentId, name: 'Bracket' }], nextOffset: 7 });
        case '/api/cad/document': return Response.json({ documentId: body.documentId, workspaceId, name: 'Bracket', workspaceName: 'Main', elements });
        case '/api/cad/features': return Response.json({ microversion: 'm1', features: [{ id: 'extrude1', name: 'Extrude 1', type: 'extrude',
          suppressed: false, parameters: [{ id: 'depth', expression: body.elementId === cover ? '5 mm' : '10 mm' }] }] });
        default: throw new Error(`Unexpected smoke endpoint ${request.pathname}`);
      }
    };
    shell.openExternal = async url => {
      const login = new URL(url);
      if (login.pathname !== '/login') throw new Error('Unexpected browser navigation');
      const callback = new URL(login.searchParams.get('redirectUri'));
      callback.search = new URLSearchParams({ state: login.searchParams.get('state'), code: 'smoke-grant' }).toString();
      await originalFetch(callback);
    };
  });
  await window.getByRole('button', { name: 'Sign in to Zither' }).click();
  await window.getByRole('button', { name: 'Bracket' }).waitFor();
  await window.screenshot({ path: '.local/desktop-documents.png' });
  await window.getByRole('button', { name: 'Load more', exact: true }).click();
  await window.getByRole('button', { name: 'Gearbox' }).waitFor();
  await window.getByLabel('Search documents').fill('cover');
  await window.getByRole('button', { name: 'Search', exact: true }).click();
  await window.getByRole('button', { name: 'Search result' }).waitFor();
  assert.equal(await window.getByRole('button', { name: 'Gearbox' }).count(), 0);
  await window.getByLabel('Search documents').fill('');
  await window.getByLabel('Document filter').selectOption('shared');
  await window.getByRole('button', { name: 'Bracket' }).waitFor();
  await window.getByRole('button', { name: 'Bracket' }).click();
  await window.getByRole('heading', { name: 'Choose a Part Studio' }).waitFor();
  assert.equal(await window.getByRole('button', { name: 'Send message' }).count(), 0);
  assert.equal(await window.getByRole('button', { name: /Drawing/ }).isDisabled(), true);
  await window.screenshot({ path: '.local/desktop-tabs.png' });
  await window.getByRole('button', { name: 'Cover Part Studio' }).click();
  await window.getByRole('textbox', { name: 'Message Zither' }).waitFor();
  assert.equal((await window.evaluate(() => window.zither.state())).target.elementId, 'd'.repeat(24));
  await window.getByRole('button', { name: 'Explain this feature tree' }).click();
  assert.equal(await window.getByRole('textbox', { name: 'Message Zither' }).inputValue(), 'Explain this feature tree');
  await window.screenshot({ path: '.local/desktop-chat.png' });
  await window.getByRole('button', { name: 'Choose file', exact: true }).click();
  await window.getByRole('button', { name: 'Bracket' }).waitFor();
  assert.equal(await window.getByRole('log', { name: 'Conversation' }).count(), 0);
  const requests = await app.evaluate(() => globalThis.documentTest.requests);
  assert.ok(requests.some(request => request.path === '/api/cad/documents' && request.body.offset === 7));
  assert.ok(requests.some(request => request.path === '/api/cad/documents' && request.body.filter === 'shared'));
  assert.ok(requests.some(request => request.path === '/api/cad/features' && request.body.elementId === 'd'.repeat(24)));
  assert.equal(requests.some(request => request.path === '/api/cad/parameter'), false);
  await app.evaluate(() => { globalThis.documentTest.restore(); delete globalThis.documentTest; });
  await assert.rejects(window.evaluate(() => window.zither.setTarget('https://example.com')), /Onshape|onshape/);
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  await window.screenshot({ path: '.local/desktop.png' });
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: document search/paging, tab selection before chat, IPC, Codex OAuth, encrypted credentials, and sandbox.');
} finally { await app.close(); }
