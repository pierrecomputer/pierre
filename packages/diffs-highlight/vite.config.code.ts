import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the sandbox realm into a single `dist/code.js`.
 *
 * Figma evaluates that file in a plain JavaScript scope with no module loader
 * and no DOM, so the output has to be one IIFE with nothing split out and no
 * imports left in it (`lib` mode disables code splitting). This pass runs first
 * and owns clearing `dist`; the UI pass writes into the same directory after it.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2017',
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/sandbox/code.ts'),
      formats: ['iife'],
      name: 'diffsHighlight',
      fileName: () => 'code.js',
    },
  },
});
