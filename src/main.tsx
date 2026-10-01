import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatEvent, DesktopBridge, FeatureSnapshot, ModelOption, PublicState } from '../shared/contracts.js';
import './style.css';

declare global { interface Window { zither?: DesktopBridge } }
type Entry = { id: string; role: 'user' | 'assistant' | 'tool'; text: string; status?: string; detail?: string };
const api = window.zither;

function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [snapshot, setSnapshot] = useState<FeatureSnapshot | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [working, setWorking] = useState('');
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [authPrompt, setAuthPrompt] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = !!working || running;

  async function refresh() {
    if (!api) return;
    const next = await api.state();
    setState(next);
    if (!next.target) setSnapshot(null);
  }
  async function perform(label: string, action: () => Promise<unknown>) {
    setWorking(label); setError('');
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : 'The operation failed.'); }
    finally { await refresh().catch(() => {}); setWorking(''); }
  }
  useEffect(() => {
    if (!api) return;
    void refresh().catch(error => setError(error.message));
    void api.models().then(setModels).catch(error => setError(error.message));
    return api.onEvent((event: ChatEvent) => {
      if (event.type === 'snapshot') setSnapshot(event.snapshot);
      if (event.type === 'error') setError(event.message);
      if (event.type === 'auth_prompt') setAuthPrompt(event.id);
      if (event.type === 'done') setRunning(false);
      if (event.type === 'text') setEntries(items => items.some(item => item.id === event.id)
        ? items.map(item => item.id === event.id ? { ...item, text: item.text + event.delta } : item)
        : [...items, { id: event.id, role: 'assistant', text: event.delta }]);
      if (event.type === 'activity') setEntries(items => {
        const entry: Entry = { id: event.id, role: 'tool', text: event.name === 'read_features' ? 'Read feature tree' : 'Edit parameter', status: event.status, detail: event.detail };
        return items.some(item => item.id === event.id) ? items.map(item => item.id === event.id ? entry : item) : [...items, entry];
      });
    });
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [entries]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!api || !prompt.trim() || busy) return;
    const text = prompt.trim(); setPrompt(''); setRunning(true); setError('');
    setEntries(items => [...items, { id: crypto.randomUUID(), role: 'user', text }]);
    try { await api.prompt(text); } catch (error) { setError((error as Error).message); }
    finally { setRunning(false); await refresh(); }
  }
  async function updateModels() { setModels(await api!.models()); }

  if (!api) return <main className="browser-note"><p className="wordmark">zither</p><h1>Open the desktop app.</h1>
    <p>This browser preview has no connection to your accounts or CAD.</p><p>Run <code>npm run dev</code> to launch Zither.</p></main>;

  return <div className="workspace">
    <aside>
      <div className="brand"><span className="wordmark">zither</span><span className="muted">Onshape assistant</span></div>
      <section>
        <h2>Connections</h2>
        <div className="connection"><span>Zither</span><span className="muted">{state?.user?.name ?? 'Signed out'}</span></div>
        {state?.user
          ? <button disabled={busy} onClick={() => perform('Signing out', async () => { await api.signOut(); setEntries([]); })}>Sign out</button>
          : <button disabled={busy} onClick={() => perform('Waiting for browser sign-in', async () => { await api.signIn(); setEntries([]); })}>Sign in to Zither ↗</button>}
        <div className="connection"><span>Onshape</span><span className={state?.onshapeConnected ? 'connected' : 'muted'}>{state?.onshapeConnected ? 'Connected' : 'Not connected'}</span></div>
        <button disabled={busy || !state?.user} onClick={() => perform('Connecting Onshape', () => state?.onshapeConnected ? api.disconnectOnshape() : api.connectOnshape())}>
          {state?.onshapeConnected ? 'Disconnect Onshape' : 'Connect Onshape ↗'}</button>
        <button className="text-button" disabled={busy} onClick={() => perform('Refreshing connections', async () => { await refresh(); await updateModels(); })}>Refresh connections</button>
      </section>
      <section>
        <h2>Model</h2>
        <label className="sr-only" htmlFor="model">Model</label>
        <select id="model" disabled={busy || !models.length} value={state?.model ? `${state.model.provider}/${state.model.id}` : ''}
          onChange={event => perform('Selecting model', async () => {
            const model = models.find(m => `${m.provider}/${m.id}` === event.target.value);
            if (model) { await api.setModel(model); setEntries([]); }
          })}>
          <option value="">Choose a model</option>
          {models.map(model => <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>{model.name} · {model.provider}</option>)}
        </select>
        <button disabled={busy} onClick={() => perform('Waiting for Codex sign-in', async () => { await api.loginCodex(); await updateModels(); setEntries([]); })}>Sign in to Codex ↗</button>
        {authPrompt && <details key={authPrompt}><summary>Browser didn’t return?</summary><form onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget;
          const value = String(new FormData(form).get('callback'));
          void api.submitCodexCallback(authPrompt, value).then(() => form.reset()).catch(error => setError(error.message));
        }}>
          <p className="hint">Finish sign-in, then paste the full localhost link from your browser’s address bar.</p>
          <label>Callback link<input name="callback" type="password" autoComplete="off" maxLength={8192} required /></label>
          <button>Finish sign-in</button>
        </form></details>}
        <details><summary>Add an API key</summary><form onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
          void perform('Saving API key', async () => { await api.saveKey(String(data.get('provider')), String(data.get('key'))); form.reset(); await updateModels(); setEntries([]); });
        }}>
          <label>Provider<select name="provider" disabled={busy}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option><option value="google">Google</option><option value="openrouter">OpenRouter</option></select></label>
          <label>API key<input name="key" type="password" autoComplete="off" required disabled={busy} /></label>
          <button disabled={busy}>Save key</button>
        </form></details>
        {state?.providers.map(provider => <div key={provider} className="connection provider"><span>{provider}</span>
          <button className="text-button" disabled={busy} onClick={() => perform('Removing connection', async () => { await api.removeProvider(provider); await updateModels(); setEntries([]); })}>Remove</button></div>)}
        <p className="hint">Keys stay on this computer. CAD context is sent to your chosen model.</p>
      </section>
      <div className="sidebar-footer">Early build <span>01</span></div>
    </aside>
    <main>
      <header><div><h1>Workspace</h1><p>{state?.target ? 'Part Studio connected' : 'Connect an existing design to begin.'}</p></div>
        <button className="text-button" disabled={busy} onClick={() => perform('Opening Onshape', () => api.openOnshape())}>Open Onshape ↗</button></header>
      <form className="document-form" onSubmit={event => { event.preventDefault(); void perform('Reading Part Studio', async () => {
        setSnapshot(await api.setTarget(url)); setEntries([]);
      }); }}>
        <label className="sr-only" htmlFor="document-url">Onshape Part Studio URL</label>
        <input id="document-url" type="url" placeholder="Paste an Onshape Part Studio link" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} required />
        <button disabled={busy || !state?.onshapeConnected}>Connect</button>
      </form>
      {snapshot && <details className="features"><summary>{snapshot.features.length} features <span className="muted">· {snapshot.microversion.slice(0, 8)}</span></summary>
        <div className="feature-list">{snapshot.features.map(feature => <details key={feature.id}><summary>{feature.name} <span className="muted">{feature.suppressed ? 'suppressed' : feature.type}</span></summary>
          {feature.parameters.length ? <dl>{feature.parameters.map(parameter => <div key={parameter.id}><dt>{parameter.id}</dt><dd>{parameter.expression}</dd></div>)}</dl> : <p className="hint">No editable expressions.</p>}
        </details>)}</div><button disabled={busy} onClick={() => perform('Reading Part Studio', async () => setSnapshot(await api.inspect()))}>Refresh features</button>
      </details>}
      <div className="chat" role="log" aria-label="Conversation">
        {!entries.length && <div className="empty"><p className="eyebrow">YOUR DESIGN, CONTINUED</p><h2>What needs changing?</h2>
          <p>Inspect the feature history or adjust an existing dimension.</p>
          <div className="suggestions">{['Explain this feature tree', 'Which dimensions can I change?'].map(text => <button key={text} disabled={busy} onClick={() => setPrompt(text)}>{text} ↗</button>)}</div>
        </div>}
        {entries.map(entry => entry.role === 'tool' ? <details className={`activity ${entry.status}`} key={entry.id}>
          <summary><span className="activity-dot" />{entry.text}<span className="muted">{entry.status === 'running' ? 'Working…' : entry.status === 'error' ? 'Failed' : 'Done'}</span></summary>
          {entry.detail && <pre>{entry.detail}</pre>}
        </details> : <article key={entry.id} className={`message ${entry.role}`}><span className="author">{entry.role === 'user' ? 'You' : 'Zither'}</span><p>{entry.text}</p></article>)}
        <div ref={bottom} />
      </div>
      {(error || state?.serverError) && <div className="error" role="alert">{error || state?.serverError}<button aria-label="Dismiss error" onClick={() => { setError(''); setState(value => value ? { ...value, serverError: undefined } : value); }}>×</button></div>}
      <footer>
        <form className="composer" onSubmit={send}>
          <label className="sr-only" htmlFor="prompt">Message Zither</label>
          <textarea id="prompt" placeholder="Describe the change…" value={prompt} maxLength={16000} rows={2} disabled={busy}
            onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          {busy ? <button type="button" onClick={() => void api.stop().catch(error => setError(error.message))}>Stop</button>
            : <button className="send" aria-label="Send message" disabled={!prompt.trim() || !state?.target || !state.model}>↑</button>}
        </form>
        <div className="footer-line"><span role="status">{working || (running ? 'Working on your request…' : state?.target ? 'Connected to your Part Studio' : 'Connect accounts, choose a model, then add a Part Studio.')}</span>
          <button className="text-button" disabled={busy || !entries.length} onClick={() => perform('Starting new chat', async () => { await api.newChat(); setEntries([]); })}>New chat</button></div>
      </footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
