import type { Models } from '@earendil-works/pi-ai';
import { z } from 'zod';

// Pi owns PKCE, the loopback callback, token exchange, and refresh.
export function codexLogin(openBrowser: (url: string) => Promise<void>, showPrompt: (id: string | null) => void) {
  let pending: { id: string; submit: (value: string) => void } | undefined;
  return {
    reply(id: string, value: string) {
      if (!pending || pending.id !== id) throw new Error('This sign-in request has ended.');
      const url = new URL(z.string().trim().min(1).max(8192).parse(value));
      if (url.origin !== 'http://localhost:1455' || url.pathname !== '/auth/callback' || url.username || url.password
        || !url.searchParams.get('code') || !url.searchParams.get('state')) throw new Error('Paste the full localhost callback link from your browser.');
      pending.submit(url.href);
    },
    async run(models: Pick<Models, 'login'>, signal: AbortSignal) {
      const controller = new AbortController();
      const loginSignal = AbortSignal.any([signal, controller.signal]);
      let browserFailed = false;
      try {
        await models.login('openai-codex', 'oauth', {
          signal: loginSignal,
          async prompt(request) {
            loginSignal.throwIfAborted();
            if (request.type === 'select' && request.options.some(option => option.id === 'browser')) return 'browser';
            if (request.type !== 'manual_code') throw new Error('Unexpected Codex login step.');
            const promptSignal = AbortSignal.any([loginSignal, ...(request.signal ? [request.signal] : [])]);
            promptSignal.throwIfAborted();
            return new Promise<string>((resolve, reject) => {
              const clear = () => { promptSignal.removeEventListener('abort', abort); pending = undefined; showPrompt(null); };
              const abort = () => { clear(); reject(new Error('Sign-in cancelled.')); };
              pending = { id: crypto.randomUUID(), submit: value => { clear(); resolve(value); } };
              promptSignal.addEventListener('abort', abort, { once: true });
              showPrompt(pending.id);
            });
          },
          notify(event) {
            if (event.type !== 'auth_url') return;
            void (async () => {
              const url = new URL(event.url);
              if (url.origin !== 'https://auth.openai.com' || url.pathname !== '/oauth/authorize' || url.username || url.password) {
                throw new Error('Unexpected Codex authorization URL.');
              }
              await openBrowser(url.href);
            })().catch(() => { browserFailed = true; controller.abort(); });
          },
        });
      } catch {
        // Provider errors may include token response bodies; keep them out of the renderer.
        throw new Error(browserFailed ? 'Could not open Codex sign-in in your browser.' : signal.aborted
          ? 'Codex sign-in cancelled or timed out.' : 'Codex sign-in failed. Please try again.');
      } finally { controller.abort(); }
    },
  };
}
