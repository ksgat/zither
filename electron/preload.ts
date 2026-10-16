import { contextBridge, ipcRenderer } from 'electron';
import type { ChatEvent, DesktopBridge } from '../shared/contracts.js';

async function call(method: string, ...args: unknown[]) {
  const result = await ipcRenderer.invoke('zither', method, args);
  if (result.error) throw new Error(result.error);
  return result.value;
}
const bridge: DesktopBridge = {
  state: () => call('state'), signIn: () => call('signIn'), signOut: () => call('signOut'),
  connectOnshape: () => call('connectOnshape'), disconnectOnshape: () => call('disconnectOnshape'),
  documents: search => call('documents', search), openDocument: id => call('openDocument', id), closeDocument: () => call('closeDocument'),
  selectElement: id => call('selectElement', id),
  setTarget: url => call('setTarget', url), inspect: () => call('inspect'), openOnshape: () => call('openOnshape'),
  models: () => call('models'), setModel: model => call('setModel', model), saveKey: (provider, key) => call('saveKey', provider, key),
  removeProvider: provider => call('removeProvider', provider),
  loginCodex: () => call('loginCodex'), submitCodexCallback: (id, value) => call('submitCodexCallback', id, value),
  prompt: text => call('prompt', text), stop: () => call('stop'), newChat: () => call('newChat'),
  onEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, event: ChatEvent) => callback(event);
    ipcRenderer.on('zither:event', listener);
    return () => { ipcRenderer.removeListener('zither:event', listener); };
  },
};
contextBridge.exposeInMainWorld('zither', bridge);
