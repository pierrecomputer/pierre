import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  splitting: false,
  treeshake: true,
  external: ['node:crypto', 'crypto'],
  tsconfig: 'tsconfig.tsup.json',
  esbuildOptions(options) {
    // Always define the URLs at build time
    options.define = {
      __API_BASE_URL__: JSON.stringify('https://api.{{org}}.code.storage'),
      __STORAGE_BASE_URL__: JSON.stringify('{{org}}.code.storage'),
    };
  },
});
