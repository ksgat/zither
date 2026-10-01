import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { parseOnshapeUrl, targetUrl, type ChatEvent, type ModelOption, type OnshapeTarget, type PublicState } from '../shared/contracts.js';
import { AppError, messageOf } from '../shared/errors.js';
import { Store } from './store.js';
import { serverApi } from './api.js';
import { loopback, randomToken, challenge } from './loopback.js';
import { loginChatGPT } from './chatgpt.js';
import { modelConnections, providerSchema } from './models.js';
import { cadAgent } from './agent.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverUrl = process.env.ZITHER_SERVER_URL ?? 'http://localhost:3001';
const origin = new URL(serverUrl);
if (origin.origin !== serverUrl || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Invalid ZITHER_SERVER_URL.');
const devUrl = process.env.ZITHER_DEV_URL;
if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('Invalid development URL.');
protocol.registerSchemesAsPrivileged([{ scheme: 'zither', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
else void start().catch(error => { dialog.showErrorBox('Zither could not start', messageOf(error)); app.quit(); });

async function start() {
  if (process.env.ZITHER_SMOKE_DATA) app.setPath('userData', resolve(process.env.ZITHER_SMOKE_DATA));
  await app.whenReady();
  const rendererRoot = resolve(here, '../renderer');
  protocol.handle('zither', request => {
    const url = new URL(request.url);
    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
    if (url.host !== 'app' || !file.startsWith(rendererRoot + sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const store = new Store(join(app.getPath('userData'), 'credentials.bin'));
  const api = serverApi(serverUrl, () => store.get<string>('session'));
  const providers = modelConnections(store);
  let target: OnshapeTarget | null = null;
  let selection = store.get<ModelOption>('model') ?? null;
  let agent: ReturnType<typeof cadAgent> | undefined;
  let busy = false;
  let authController: AbortController | undefined;
  let changing = false;
  let stopRequested = false;
  const window = new BrowserWindow({ width: 1050, height: 780, minWidth: 720, minHeight: 560, title: 'Zither',
    show: !process.env.ZITHER_SMOKE_DATA,
    backgroundColor: '#f6f5f1', webPreferences: { preload: join(here, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  app.on('second-instance', () => { if (window.isMinimized()) window.restore(); window.focus(); });
  window.on('closed', () => { authController?.abort(); agent?.stop(); app.quit(); });
  const emit = (event: ChatEvent) => { if (!window.isDestroyed()) window.webContents.send('zither:event', event); };

  async function browserAuth(action: (signal: AbortSignal) => Promise<void>) {
    authController = new AbortController();
    const signal = AbortSignal.any([authController.signal, AbortSignal.timeout(180_000)]);
    try { await action(signal); } finally { authController = undefined; }
  }
  async function publicState(): Promise<PublicState> {
    let user = null, onshapeConnected = false, serverError: string | undefined;
    if (store.get<string>('session')) {
      try { ({ user, onshapeConnected } = await api.request<{ user: PublicState['user']; onshapeConnected: boolean }>('/api/session')); }
      catch (error) {
        if (error instanceof AppError && error.status === 401) { store.set('session', undefined); target = null; agent = undefined; }
        serverError = messageOf(error);
      }
    }
    return { serverUrl, user, onshapeConnected, providers: (await store.credentials.list()).map(p => p.providerId),
      model: selection, target, busy, serverError };
  }
  const methods: Record<string, (...args: never[]) => unknown> = {
    state: publicState,
    async signIn() {
      await browserAuth(async signal => {
        const state = randomToken(), verifier = randomToken();
        const callback = await loopback(state, signal);
        try {
          const url = new URL('/login', serverUrl);
          url.search = new URLSearchParams({ state, challenge: challenge(verifier), redirectUri: callback.redirectUri }).toString();
          await shell.openExternal(url.href);
          const returned = await callback.result;
          const result = await api.request<{ token: string }>('/desktop/exchange', { code: returned.searchParams.get('code'), verifier, redirectUri: callback.redirectUri }, 'POST', signal);
          store.set('session', result.token); target = null; agent = undefined;
        } finally { callback.close(); }
      });
    },
    async signOut() {
      await api.request('/api/session/signout', {});
      store.set('session', undefined); target = null; agent = undefined;
    },
    async connectOnshape() {
      const { url } = await api.request<{ url: string }>('/api/onshape/connect', {});
      if (new URL(url).origin !== serverUrl || new URL(url).pathname !== '/onshape/connect') throw new Error('Invalid Onshape connection URL.');
      await shell.openExternal(url);
    },
    async disconnectOnshape() { await api.request('/api/onshape', undefined, 'DELETE'); target = null; agent = undefined; },
    async setTarget(url: string) {
      const next = parseOnshapeUrl(z.string().max(4096).parse(url));
      const snapshot = await api.cad.inspect(next);
      target = next; agent = undefined;
      return snapshot;
    },
    async inspect() { if (!target) throw new Error('Choose a Part Studio first.'); return api.cad.inspect(target); },
    async openOnshape() { await shell.openExternal(target ? targetUrl(target) : 'https://cad.onshape.com'); },
    models: () => providers.list(),
    async setModel(value: ModelOption) {
      const choice = z.object({ provider: providerSchema, id: z.string().min(1).max(200), name: z.string().max(200) }).parse(value);
      const model = providers.selected(choice.provider, choice.id);
      selection = { provider: model.provider, id: model.id, name: model.name };
      store.set('model', selection); agent = undefined;
    },
    async saveKey(provider: string, key: string) {
      providerSchema.parse(provider); z.string().trim().min(1).max(4096).parse(key);
      await store.credentials.modify(provider, async () => ({ type: 'api_key', key: key.trim() }));
      agent = undefined;
    },
    async loginChatGPT() {
      await browserAuth(async signal => {
        const deviceId = store.get<string>('deviceId') ?? crypto.randomUUID();
        store.set('deviceId', deviceId);
        const previous = await store.credentials.read('openai');
        const credential = await loginChatGPT(deviceId, url => shell.openExternal(url), signal, previous?.type === 'oauth' ? previous : undefined);
        await store.credentials.modify('openai', async () => credential);
        agent = undefined;
      });
    },
    async removeProvider(provider: string) {
      providerSchema.parse(provider); await store.credentials.delete(provider);
      if (selection?.provider === provider) { selection = null; store.set('model', null); }
      agent = undefined;
    },
    async prompt(text: string) {
      z.string().trim().min(1).max(16000).parse(text);
      if (!target || !selection) throw new Error('Connect a Part Studio and choose a model first.');
      busy = true;
      stopRequested = false;
      try {
        if (!agent) {
          await providers.list();
          if (stopRequested) return;
          agent = cadAgent(providers.selected(selection.provider, selection.id), providers.models.streamSimple.bind(providers.models), api.cad, target, emit);
        }
        await agent.prompt(text);
      } finally { busy = false; emit({ type: 'done' }); }
    },
    async stop() { stopRequested = true; authController?.abort(); agent?.stop(); await agent?.idle(); },
    newChat() { agent = undefined; },
  };
  ipcMain.handle('zither', async (event, method: unknown, args: unknown) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { error: 'Invalid sender.' };
    const senderUrl = event.senderFrame.url;
    if (devUrl ? new URL(senderUrl).origin !== devUrl : senderUrl !== 'zither://app/index.html') return { error: 'Invalid sender origin.' };
    if (typeof method !== 'string' || !Object.hasOwn(methods, method) || !Array.isArray(args)) return { error: 'Unknown operation.' };
    const mutates = !['state', 'stop', 'openOnshape'].includes(method);
    if (mutates && (busy || changing)) return { error: 'Finish or stop the current operation first.' };
    if (mutates) changing = true;
    try { return { value: await methods[method](...args as never[]) }; }
    catch (error) { return { error: messageOf(error) }; }
    finally { if (mutates) changing = false; }
  });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadURL('zither://app/index.html');
}
