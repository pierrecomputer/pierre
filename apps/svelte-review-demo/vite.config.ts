import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '@pierre/diffs/svelte/review': resolve(
        __dirname,
        '../../packages/diffs/dist/svelte/review/index.js'
      ),
    },
  },
  server: {
    watch: {
      ignored: ['**/packages/diffs/dist/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
