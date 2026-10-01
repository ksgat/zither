import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, createHash } from 'node:crypto';

export const randomToken = () => randomBytes(32).toString('base64url');
export const challenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export async function loopback(state: string, signal: AbortSignal, path = '/callback') {
  let resolve!: (url: URL) => void, reject!: (error: Error) => void;
  const result = new Promise<URL>((yes, no) => { resolve = yes; reject = no; });
  // Register a handler immediately, even if opening the browser subsequently fails.
  void result.catch(() => {});
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (req.method !== 'GET' || url.pathname !== path || url.searchParams.get('state') !== state) {
      res.writeHead(400).end('Invalid sign-in callback.'); return;
    }
    if (url.searchParams.has('error')) {
      res.end('Sign-in cancelled. Return to Zither.'); reject(new Error('Sign-in was cancelled.')); return;
    }
    if (!url.searchParams.get('code')) { res.writeHead(400).end('Missing authorization code.'); return; }
    res.end('You can return to Zither.'); resolve(url);
  });
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
  const close = () => { server.close(); server.closeAllConnections(); };
  const abort = () => { reject(new Error('Sign-in cancelled or timed out.')); close(); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return { redirectUri, result,
    close: () => { signal.removeEventListener('abort', abort); close(); } };
}
