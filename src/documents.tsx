import { useEffect, useState } from 'react';
import type { CadDocument, DesktopBridge, DocumentPage, DocumentSearch, FeatureSnapshot } from '../shared/contracts.js';

export function Documents({ api, document, connected, busy, refreshKey, perform, onSelect }: {
  api: DesktopBridge; document: CadDocument | null; connected: boolean; busy: boolean; refreshKey: number;
  perform(label: string, action: () => Promise<unknown>): Promise<void>;
  onSelect(snapshot: FeatureSnapshot): void;
}) {
  const [page, setPage] = useState<DocumentPage | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocumentSearch['filter']>('all');
  const [search, setSearch] = useState<DocumentSearch>({ query: '', filter: 'all', offset: 0 });
  const [url, setUrl] = useState('');

  function load(input: DocumentSearch, append = false) {
    return perform('Loading documents', async () => {
      const next = await api.documents(input);
      setSearch(input);
      setPage(previous => ({ ...next, items: append
        ? [...(previous?.items ?? []), ...next.items.filter(item => !previous?.items.some(old => old.id === item.id))]
        : next.items }));
    });
  }
  useEffect(() => {
    if (!connected) setPage(null);
    else if (!document) void load({ query, filter, offset: 0 });
  }, [connected, document, refreshKey]);

  if (document) return <section className="file-picker" aria-label="Document tabs">
    <p className="eyebrow">{document.workspaceName ?? 'SELECTED WORKSPACE'}</p>
    <h2>Choose a Part Studio</h2>
    <p className="muted">Start here. Zither can read and edit other Part Studios in this document as you ask.</p>
    <div className="file-list">{document.elements.map(element => <button key={element.id} className="file-row"
      disabled={busy || element.elementType !== 'PARTSTUDIO'}
      onClick={() => perform('Reading Part Studio', async () => onSelect(await api.selectElement(element.id)))}>
      <span>{element.name}</span><span className="muted">{element.elementType === 'PARTSTUDIO' ? 'Part Studio →' : `${element.elementType} · not supported yet`}</span>
    </button>)}</div>
    {!document.elements.some(element => element.elementType === 'PARTSTUDIO') && <p>No Part Studios in this workspace. Choose another document.</p>}
    <button disabled={busy} onClick={() => perform('Loading documents', () => api.closeDocument())}>← All documents</button>
  </section>;

  return <section className="file-picker" aria-label="Onshape documents">
    <p className="eyebrow">YOUR ONSHAPE FILES</p><h2>Choose a document</h2>
    {!connected ? <p className="muted">Sign in to Zither and connect Onshape to browse your documents.</p> : <>
      <form className="file-search" onSubmit={event => { event.preventDefault(); void load({ query, filter, offset: 0 }); }}>
        <label className="sr-only" htmlFor="document-search">Search documents</label>
        <input id="document-search" type="search" placeholder="Search documents…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} disabled={busy} />
        <label className="sr-only" htmlFor="document-filter">Document filter</label>
        <select id="document-filter" value={filter} disabled={busy} onChange={event => {
          const next = event.target.value as DocumentSearch['filter']; setFilter(next); void load({ query, filter: next, offset: 0 });
        }}><option value="all">My documents</option><option value="shared">Shared with me</option><option value="recent">Recent</option></select>
        <button disabled={busy}>Search</button>
      </form>
      <div className="file-list">{page?.items.map(item => <button className="file-row" key={item.id} disabled={busy}
        onClick={() => perform('Opening document', () => api.openDocument(item.id))}><span>{item.name}</span><span aria-hidden="true">→</span></button>)}</div>
      {page && !page.items.length && <p className="muted">No documents found. Try another search or filter.</p>}
      {page?.nextOffset != null && <button disabled={busy} onClick={() => load({ ...search, offset: page.nextOffset! }, true)}>Load more</button>}
      {!page && !busy && <button onClick={() => load({ query, filter, offset: 0 })}>Load documents</button>}
      <details className="link-entry"><summary>Open a Part Studio link</summary>
        <form className="file-search" onSubmit={event => { event.preventDefault(); void perform('Opening Part Studio', async () => onSelect(await api.setTarget(url))); }}>
          <label className="sr-only" htmlFor="document-url">Onshape Part Studio URL</label>
          <input id="document-url" type="url" placeholder="Paste an Onshape Part Studio link" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} required />
          <button disabled={busy}>Open</button>
        </form>
      </details>
    </>}
  </section>;
}
