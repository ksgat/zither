import { createModels, type Api, type Model } from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { googleProvider } from '@earendil-works/pi-ai/providers/google';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import { z } from 'zod';
import type { Store } from './store.js';
import { refreshChatGPT } from './chatgpt.js';

export const providerSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter']);
export function modelConnections(store: Store) {
  const models = createModels({ credentials: store.credentials,
    // Only credentials deliberately connected in Zither are used.
    authContext: { env: async () => undefined, fileExists: async () => false } });
  const openai = openaiProvider();
  openai.auth.oauth!.refresh = refreshChatGPT;
  for (const provider of [openai, anthropicProvider(), googleProvider(), openrouterProvider()]) models.setProvider(provider);
  let available: Model<Api>[] = [];
  return {
    models,
    async list() {
      const credential = await store.credentials.read('openai');
      const all = [...await models.getAvailable()];
      if (credential?.type === 'oauth') {
        const auth = await models.getAuth('openai');
        const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${auth!.auth.apiKey}` },
          signal: AbortSignal.timeout(20_000), redirect: 'error' });
        if (!response.ok) throw new Error('Could not load models available to your ChatGPT account.');
        const data = z.object({ models: z.array(z.object({ slug: z.string(), display_name: z.string(), visibility: z.string() })) }).parse(await response.json());
        const accountModels: Model<Api>[] = data.models.filter(m => m.visibility === 'list').map(m => ({
          ...(models.getModel('openai', m.slug) ?? { api: 'openai-responses', provider: 'openai', baseUrl: 'https://api.openai.com/v1',
            reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 4096 }),
          id: m.slug, name: m.display_name,
        }));
        available = [...all.filter(m => m.provider !== 'openai'), ...accountModels];
      } else { available = all; }
      return available.map(({ provider, id, name }) => ({ provider, id, name }));
    },
    selected(provider: string, id: string) {
      const model = available.find(m => m.provider === provider && m.id === id);
      if (!model) throw new Error('Choose an available model.');
      return model;
    },
  };
}
