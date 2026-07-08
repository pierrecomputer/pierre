import { defineConfig, type UserConfig } from 'vite';

// Vite only serves and builds the index.html demo page (output: site/, for
// the standalone Vercel deploy). The npm library is built by tsdown — see
// tsdown.config.ts.
const config: UserConfig = defineConfig({
  build: {
    outDir: 'site',
  },
});

export default config;
