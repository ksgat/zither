import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { auth as authType } from './auth.js';
import type { desktopSessions } from './sessions.js';
import type { onshapeConnections } from './connections.js';
import { targetSchema, workspaceSchema, onshapeId, documentSearchSchema, editSchema } from '../shared/contracts.js';
import { AppError } from '../shared/errors.js';

export function createApp(auth: typeof authType, sessions: ReturnType<typeof desktopSessions>,
  connections: ReturnType<typeof onshapeConnections>, origin: string, providers: string[]) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ strictTransportSecurity: origin.startsWith('https:') ? undefined : false,
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: origin.startsWith('https:') ? [] : null } } }));
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.all('/api/auth/{*path}', toNodeHandler(auth));
  app.use(express.json({ limit: '32kb' }));
  app.use('/assets', express.static(fileURLToPath(new URL('./public', import.meta.url))));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/public-config', (_req, res) => res.json({ providers }));
  app.get('/login', (_req, res) => res.sendFile(fileURLToPath(new URL('./public/login.html', import.meta.url))));

  async function browserUser(req: express.Request) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new AppError('unauthorized', 'Sign in to Zither in this browser.', 401);
    return session.user;
  }
  app.post('/desktop/authorize', async (req, res) => {
    if (req.headers.origin !== origin) throw new AppError('invalid_origin', 'Invalid sign-in origin.', 403);
    const user = await browserUser(req);
    res.json({ url: await sessions.authorize(user.id, req.body) });
  });
  app.post('/desktop/exchange', rateLimit({ windowMs: 60_000, limit: 20 }), async (req, res) => res.json(await sessions.exchange(req.body)));
  app.get('/api/session', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    res.json({ user, onshapeConnected: await connections.connected(user.id) });
  });
  app.post('/api/session/signout', async (req, res) => {
    await sessions.user(req.headers.authorization);
    await sessions.revoke(req.headers.authorization!);
    res.json({ ok: true });
  });
  app.post('/api/onshape/connect', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    res.json({ url: await connections.start(user.id) });
  });
  app.get('/onshape/connect', async (req, res) => {
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.state);
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) return res.redirect(`/login?onshapeState=${state}`);
    res.redirect(await connections.authorize(session.user.id, state));
  });
  app.get('/onshape/callback', async (req, res) => {
    const user = await browserUser(req);
    if (req.query.error) throw new AppError('consent_denied', 'Onshape connection was cancelled. Return to Zither to try again.');
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.state);
    const code = z.string().min(1).max(2048).parse(req.query.code);
    await connections.finish(user.id, state, code);
    res.type('text').send('Onshape connected. Return to Zither; your documents will load automatically.');
  });
  app.delete('/api/onshape', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    await connections.disconnect(user.id);
    res.json({ ok: true });
  });
  app.post('/api/cad/documents', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    const search = documentSearchSchema.parse(req.body);
    res.json(await (await connections.client(user.id)).documents(search));
  });
  app.post('/api/cad/document', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    const input = z.object({ documentId: onshapeId, workspaceId: onshapeId.optional() }).strict().parse(req.body);
    res.json(await (await connections.client(user.id)).document(input.documentId, input.workspaceId));
  });
  app.post('/api/cad/elements', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    const workspace = workspaceSchema.parse(req.body);
    res.json(await (await connections.client(user.id)).elements(workspace));
  });
  app.post('/api/cad/features', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    const target = targetSchema.parse(req.body);
    res.json(await (await connections.client(user.id)).inspect(target));
  });
  app.post('/api/cad/parameter', async (req, res) => {
    const user = await sessions.user(req.headers.authorization);
    const edit = editSchema.parse(req.body);
    res.json(await (await connections.client(user.id)).edit(edit));
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request or upstream data.', code: 'invalid_data' });
    // Never return DB errors, OAuth responses, or secrets to clients.
    res.status(500).json({ error: 'Request failed. Check server configuration and try again.', code: 'server_error' });
  });
  return app;
}
