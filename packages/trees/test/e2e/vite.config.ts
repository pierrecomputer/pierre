import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const defaultPort = 9221;
const portFromEnv = Number(process.env.FILE_TREE_E2E_PORT);
const port = Number.isFinite(portFromEnv) ? portFromEnv : defaultPort;

export default defineConfig({
  publicDir: resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'apps/docs/public'
  ),
  root: resolve(import.meta.dirname, '..', '..'),
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});
