import { build } from 'esbuild';

await build({ entryPoints: ['electron/main.ts'], outdir: 'dist/electron', bundle: true, platform: 'node',
  target: 'node22', format: 'esm', packages: 'external', sourcemap: true });
await build({ entryPoints: ['electron/preload.ts'], outfile: 'dist/electron/preload.cjs', bundle: true,
  platform: 'node', target: 'node22', format: 'cjs', external: ['electron'] });
