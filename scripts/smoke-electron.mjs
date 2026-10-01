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
  await window.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
  assert.equal(await window.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await window.evaluate(() => typeof window.zither), 'object');
  assert.equal(await window.evaluate(() => typeof window.zither.loginChatGPT), 'undefined');
  assert.equal(await window.getByRole('button', { name: /ChatGPT/ }).count(), 0);
  const state = await window.evaluate(() => window.zither.state());
  assert.equal(state.user, null);
  assert.equal(state.target, null);
  assert.equal(await window.getByRole('button', { name: 'Send message' }).isDisabled(), true);
  await window.getByRole('button', { name: 'Explain this feature tree' }).click();
  assert.equal(await window.getByRole('textbox', { name: 'Message Zither' }).inputValue(), 'Explain this feature tree');
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
  await assert.rejects(window.evaluate(() => window.zither.setTarget('https://example.com')), /Onshape|onshape/);
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  await window.screenshot({ path: '.local/desktop.png' });
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: renderer, IPC, Codex OAuth and cancellation, encrypted credentials, model catalog, and sandbox.');
} finally { await app.close(); }
