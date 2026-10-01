import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { parse } from 'dotenv';
import electron from 'electron';
import './build.mjs';

const env = await readFile('.env', 'utf8').then(parse).catch(() => ({}));
const server = await createServer();
await server.listen();
const desktopEnv = { ...process.env };
delete desktopEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...desktopEnv,
  ZITHER_DEV_URL: 'http://127.0.0.1:5173', ZITHER_SERVER_URL: process.env.ZITHER_SERVER_URL ?? env.ZITHER_SERVER_URL ?? 'http://localhost:3001' } });
child.on('exit', async code => { await server.close(); process.exit(code ?? 0); });
child.on('error', async error => { console.error(error.message); await server.close(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill());
