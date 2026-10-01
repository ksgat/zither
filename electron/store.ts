import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import type { Credential, CredentialStore } from '@earendil-works/pi-ai';

export class Store {
  private data: Record<string, unknown> = {};
  private pending = Promise.resolve();
  constructor(private path: string) {
    if (existsSync(path)) {
      this.checkEncryption();
      this.data = JSON.parse(safeStorage.decryptString(readFileSync(path)));
    }
  }
  get<T>(key: string): T | undefined { return structuredClone(this.data[key]) as T | undefined; }
  set(key: string, value: unknown) {
    this.checkEncryption();
    const next = { ...this.data, [key]: value };
    writeFileSync(`${this.path}.tmp`, safeStorage.encryptString(JSON.stringify(next)), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
    this.data = next;
  }
  private checkEncryption() {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('An operating-system credential store is required to save credentials.');
    }
  }
  readonly credentials: CredentialStore = {
    read: async provider => this.get<Credential>(`provider:${provider}`),
    list: async () => Object.entries(this.data).filter(([key, value]) => key.startsWith('provider:') && value)
      .map(([key, value]) => ({ providerId: key.slice(9), type: (value as Credential).type })),
    modify: (provider, fn) => {
      const operation = this.pending.then(async () => {
        const value = await fn(this.get<Credential>(`provider:${provider}`));
        if (value) this.set(`provider:${provider}`, value);
        return this.get<Credential>(`provider:${provider}`);
      });
      this.pending = operation.then(() => {}, () => {});
      return operation;
    },
    delete: provider => {
      const operation = this.pending.then(() => this.set(`provider:${provider}`, undefined));
      this.pending = operation.catch(() => {});
      return operation;
    },
  };
}
