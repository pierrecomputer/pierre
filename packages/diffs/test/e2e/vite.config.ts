import { resolve } from 'node:path';
import { defineConfig, type UserConfig } from 'vite';

const defaultPort = 4175;
const portFromEnv = Number(process.env.DIFFS_E2E_PORT);
const port = Number.isFinite(portFromEnv) ? portFromEnv : defaultPort;

// Serve the package root so fixtures can import the built library directly via
// `/dist/index.js` and `/dist/editor/index.js`. Vite resolves the bundle's bare
// dependency imports (shiki, etc.) from node_modules on the fly.
const config: UserConfig = defineConfig({
  root: resolve(import.meta.dirname, '..', '..'),
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});

export default config;
