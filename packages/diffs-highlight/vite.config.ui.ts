import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Builds the UI realm into a single `dist/ui.html`.
 *
 * Figma hands the UI document to the iframe as a string and loads nothing else,
 * so every script and stylesheet has to be inlined, which is what
 * `viteSingleFile` does. Vite names an HTML output after its input, so the entry
 * is `ui.html` rather than the conventional `index.html` — that is what makes the
 * output land at the `dist/ui.html` manifest.json points at.
 *
 * This pass runs after the sandbox pass and must not wipe its output, hence
 * `emptyOutDir: false`.
 */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2017',
    minify: false,
    rollupOptions: {
      input: 'ui.html',
    },
  },
});
