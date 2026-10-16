import { createModels, type Api, type Model } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { z } from 'zod';
import type { Store } from './store.js';
import type { ModelOption } from '../shared/contracts.js';

export const apiKeyProviderSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter']);
export const providerSchema = z.enum([...apiKeyProviderSchema.options, 'openai-codex']);
export async function migrateModelCredentials(store: Pick<Store, 'credentials' | 'get' | 'set'>) {
  // Retire the former ChatGPT connection without touching API keys or Codex.
  if ((await store.credentials.read('openai'))?.type === 'oauth') {
    await store.credentials.delete('openai');
    if (store.get<ModelOption>('model')?.provider === 'openai') store.set('model', null);
  }
  if (store.get('deviceId') !== undefined) store.set('deviceId', undefined);
}

export function modelConnections(store: Pick<Store, 'credentials'>) {
  const models = createModels({ credentials: store.credentials,
    // Only credentials deliberately connected in Zither are used.
    authContext: { env: async () => undefined, fileExists: async () => false } });
  const openai = openaiProvider();
  delete openai.auth.oauth;
  for (const provider of [openai, openaiCodexProvider(), anthropicProvider(), googleProvider(), openrouterProvider()]) models.setProvider(provider);
  let available: Model<Api>[] = [];
  return {
    models,
    async list() {
      available = [...await models.getAvailable()];
      return available.map(({ provider, id, name }) => ({ provider, id, name }));
    },
    selected(provider: string, id: string) {
      const model = available.find(m => m.provider === provider && m.id === id);
      if (!model) throw new Error('Choose an available model.');
      return model;
    },
  };
}
