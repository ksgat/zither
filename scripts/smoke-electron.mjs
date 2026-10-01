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
  await assert.rejects(window.evaluate(() => window.zither.setTarget('https://example.com')), /Onshape|onshape/);
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  await window.screenshot({ path: '.local/desktop.png' });
  assert.deepEqual(errors, []);
  console.log('Electron smoke passed: renderer, IPC, native controls, credential encryption, model catalog, and sandbox.');
} finally { await app.close(); }
