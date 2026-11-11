import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'tsdown';

const tokenTypesPath = fileURLToPath(
  new URL('./lib/token-types.ts', import.meta.url)
);
const themesPath = fileURLToPath(new URL('./themes/index.ts', import.meta.url));

// The two configs share dist/, so neither may clean the other's output.
// `scripts/build.ts` emits highlights.wasm and highlights.wasm.mjs
// before tsdown runs (see moon.yml); keep ./highlights.wasm* imports as-is for
// runtime resolution next to the glue. tsdown builds the two configs
// concurrently, which is why the wasm phase cannot live in a build hook: it
// rewrites the token and language tables, which the first config compiles.
const config: UserConfig[] = defineConfig([
  {
    entry: [
      'lib/index.ts',
      'lib/core.ts',
      'lib/core-workerd.ts',
      'lib/highlighter.ts',
      'lib/live.ts',
      'lib/tokens.ts',
      'lib/theme.ts',
      'lib/token-types.ts',
      'lib/languages.ts',
      'lib/workerd.ts',
    ],
    tsconfig: './tsconfig.json',
    clean: false,
    dts: {
      sourcemap: true,
      tsgo: true,
    },
    unbundle: true,
    platform: 'neutral',
    deps: {
      neverBundle: [/^\.\/(?:highlights|emitter)\.wasm/, /^node:/, themesPath],
    },
    // The main entry re-exports the separately bundled themes module.
    outputOptions: { paths: { [themesPath]: './themes.js' } },
  },
  // Bundle named theme exports into one module. scripts/build.ts writes the
  // separate loader so lazy imports do not pull in every theme's data.
  // Reuse the token table emitted by the first config for toCSS.
  {
    entry: { themes: 'themes/index.ts' },
    tsconfig: './tsconfig.json',
    clean: false,
    dts: {
      sourcemap: true,
      tsgo: true,
    },
    platform: 'neutral',
    deps: { neverBundle: [tokenTypesPath, /^\.\/emitter\.wasm/] },
    outputOptions: { paths: { [tokenTypesPath]: './token-types.js' } },
  },
]);

export default config;
