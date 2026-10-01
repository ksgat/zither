import { auth, db } from './auth.js';
import { config } from './config.js';
import { createApp } from './app.js';
import { desktopSessions } from './sessions.js';
import { onshapeConnections } from './connections.js';

const connections = onshapeConnections(db, { origin: config.BETTER_AUTH_URL, clientId: config.ONSHAPE_CLIENT_ID,
  clientSecret: config.ONSHAPE_CLIENT_SECRET, encryptionKey: config.TOKEN_ENCRYPTION_KEY, apiVersion: config.ONSHAPE_API_VERSION });
const providers = [config.GOOGLE_CLIENT_ID && 'google', config.GITHUB_CLIENT_ID && 'github'].filter(Boolean) as string[];
const server = createApp(auth, desktopSessions(db), connections, config.BETTER_AUTH_URL, providers).listen(config.PORT, () => {
  console.log(`Zither server listening on port ${config.PORT}`);
});
// Expiring one-time grants and desktop sessions are bounded in persistent storage.
const cleanup = setInterval(() => {
  void Promise.all(['desktop_grants', 'desktop_sessions', 'onshape_oauth_states'].map(table =>
    db.query(`DELETE FROM ${table} WHERE expires_at < now()`))).catch(() => console.error('Session cleanup failed.'));
}, 60_000).unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  clearInterval(cleanup);
  server.close(() => { void db.end(); });
});
