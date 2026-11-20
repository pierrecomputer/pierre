import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';

// The benchmark serves a production build: React's development build adds work
// that users never pay, and it would hide the cost of the layout itself.
const config: UserConfig = defineConfig({
  root: fileURLToPath(new URL('fixture', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('dist', import.meta.url)),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('fixture/index.html', import.meta.url)),
        selftest: fileURLToPath(
          new URL('fixture/selftest.html', import.meta.url)
        ),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.LAYOUTS_BENCH_PORT ?? 4178),
    strictPort: true,
  },
});

export default config;
