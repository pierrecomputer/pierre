import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';

const config: UserConfig = defineConfig({
  root: fileURLToPath(new URL('../../demo', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LAYOUTS_E2E_PORT ?? 4177),
    strictPort: true,
  },
});

export default config;
