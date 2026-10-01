import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createApp } from '../server/app.js';
import { serverApi } from '../electron/api.js';
import { AppError } from '../shared/errors.js';

it('authenticates discovery routes and carries validated document selection through the HTTP client', async () => {
  const documentId = 'a'.repeat(24), workspaceId = 'b'.repeat(24);
  const page = { items: [{ id: documentId, name: 'Bracket' }], nextOffset: null };
  const document = { documentId, workspaceId, name: 'Bracket', elements: [] };
  const cad = { documents: vi.fn().mockResolvedValue(page), document: vi.fn().mockResolvedValue(document), elements: vi.fn().mockResolvedValue([]) };
  const client = vi.fn().mockResolvedValue(cad);
  type Dependencies = Parameters<typeof createApp>;
  const app = createApp({ handler: () => new Response() } as unknown as Dependencies[0], {
    user: async (authorization: string) => {
      if (authorization !== 'Bearer test-session') throw new AppError('unauthorized', 'Sign in first.', 401);
      return { id: 'test-user' };
    },
  } as unknown as Dependencies[1], { client } as unknown as Dependencies[2], 'http://localhost:3001', []);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of ['documents', 'document', 'elements']) {
      const response = await fetch(`${origin}/api/cad/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
    }
    expect(client).not.toHaveBeenCalled();
    const api = serverApi(origin, () => 'test-session');
    await expect(api.cad.documents({ query: 'bracket', filter: 'all', offset: 0 })).resolves.toEqual(page);
    await expect(api.cad.document(documentId, workspaceId)).resolves.toEqual(document);
    await expect(api.cad.elements({ documentId, workspaceId })).resolves.toEqual([]);
    expect(client.mock.calls.map(call => call[0])).toEqual(['test-user', 'test-user', 'test-user']);
    expect(cad.document).toHaveBeenCalledWith(documentId, workspaceId);
    await expect(api.request('/api/cad/elements', { documentId, workspaceId, elementId: 'c'.repeat(24) })).rejects.toMatchObject({ status: 400 });
    expect(client).toHaveBeenCalledTimes(3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
