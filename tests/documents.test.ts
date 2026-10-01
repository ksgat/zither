import { expect, it, vi } from 'vitest';
import { OnshapeClient } from '../server/onshape.js';

const documentId = 'a'.repeat(24), workspaceId = 'b'.repeat(24), elementId = 'c'.repeat(24);
it('searches and pages documents without following upstream URLs or assuming full pages', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ items: [
    { id: documentId, name: 'Bracket' }, { id: 'd'.repeat(24), name: 'Folder', isContainer: true },
  ], next: 'https://cad.onshape.com/api/v17/documents?offset=7&limit=20' }))
    .mockResolvedValueOnce(Response.json({ items: [], next: null }));
  const cad = new OnshapeClient('test-token', 'v17', fetcher);
  const page = await cad.documents({ query: 'bolt & nut', filter: 'shared', offset: 0 });
  expect(page).toEqual({ items: [{ id: documentId, name: 'Bracket' }], nextOffset: 7 });
  const url = new URL(String(fetcher.mock.calls[0][0]));
  expect(url.searchParams.get('q')).toBe('bolt & nut');
  expect(url.searchParams.get('filter')).toBe('2');
  expect(url.searchParams.get('limit')).toBe('20');
  expect(await cad.documents({ query: 'bolt & nut', filter: 'shared', offset: 7 })).toEqual({ items: [], nextOffset: null });
  expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get('offset')).toBe('7');
});
it.each(['https://evil.example/api/documents?offset=20', 'https://cad.onshape.com/api/users?offset=20',
  'https://cad.onshape.com/api/documents?offset=0'])('rejects invalid pagination %s', async next => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [], next }));
  await expect(new OnshapeClient('test-token', 'v17', fetcher).documents({ query: '', filter: 'all', offset: 0 })).rejects.toThrow('invalid document page');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('opens the default workspace and lists every live tab without needing the kernel', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: documentId, name: 'Bracket', defaultWorkspace: { id: workspaceId, name: 'Main' } }))
    .mockResolvedValueOnce(Response.json([
      { id: elementId, name: 'Base', elementType: 'PARTSTUDIO' },
      { id: 'd'.repeat(24), name: 'Assembly', elementType: 'ASSEMBLY' },
      { id: 'e'.repeat(24), name: 'Old', elementType: 'PARTSTUDIO', deleted: true },
    ]));
  expect(await new OnshapeClient('test-token', 'v17', fetcher).document(documentId)).toEqual({ documentId, workspaceId, name: 'Bracket', workspaceName: 'Main', elements: [
    { id: elementId, name: 'Base', elementType: 'PARTSTUDIO' }, { id: 'd'.repeat(24), name: 'Assembly', elementType: 'ASSEMBLY' },
  ] });
  expect(fetcher.mock.calls[1][0]).toBe(`https://cad.onshape.com/api/v17/documents/d/${documentId}/w/${workspaceId}/elements`);
});
it('preserves a workspace from a pasted link and rejects documents with no workspace', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: documentId, name: 'Bracket', defaultWorkspace: { id: 'f'.repeat(24), name: 'Main' } }))
    .mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json({ id: documentId, name: 'Published only' }));
  const cad = new OnshapeClient('test-token', 'v17', fetcher);
  expect(await cad.document(documentId, workspaceId)).toMatchObject({ workspaceId, workspaceName: undefined });
  await expect(cad.document(documentId)).rejects.toThrow('no accessible workspace');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
