import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const defaultPort = 4176;
const portFromEnv = Number(process.env.PATH_STORE_DEMO_E2E_PORT);
const port = Number.isFinite(portFromEnv) ? portFromEnv : defaultPort;

export default defineConfig({
  root: resolve(import.meta.dirname, '..', '..', 'demo'),
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});
