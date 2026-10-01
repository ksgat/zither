import type { CadClient, CadDocument, CadElement, DocumentPage, EditResult, FeatureSnapshot } from '../shared/contracts.js';
import { AppError } from '../shared/errors.js';

export function serverApi(origin: string, token: () => string | undefined) {
  async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${origin}${path}`, { method, redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
        headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new AppError('connection_failed', path === '/api/cad/parameter'
        ? 'The edit response was lost. It may have applied. Inspect Onshape before continuing.'
        : `Could not reach the Zither server at ${origin}.`);
    }
    const data = await response.json();
    if (!response.ok) throw new AppError(data.code ?? 'request_failed', data.error ?? `Request failed (${response.status}).`, response.status);
    return data;
  }
  const cad: CadClient = {
    documents: (search, signal) => request<DocumentPage>('/api/cad/documents', search, 'POST', signal),
    document: (documentId, workspaceId, signal) => request<CadDocument>('/api/cad/document', { documentId, workspaceId }, 'POST', signal),
    elements: (workspace, signal) => request<CadElement[]>('/api/cad/elements', workspace, 'POST', signal),
    inspect: (target, signal) => request<FeatureSnapshot>('/api/cad/features', target, 'POST', signal),
    edit: (edit, signal) => request<EditResult>('/api/cad/parameter', edit, 'POST', signal),
  };
  return { request, cad };
}
