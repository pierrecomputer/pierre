import { defineConfig, type UserConfig } from 'tsdown';

// scripts/build.ts emits the wasm artifacts (chamele.wat, chamele.wasm,
// chamele.wasm.mjs) into dist/ before tsdown runs (see the moon build task),
// so tsdown must not clean dist/ and must keep ./chamele.wasm* imports as-is
// for runtime resolution next to the compiled glue.
const config: UserConfig[] = defineConfig([
  {
    entry: [
      'lib/index.ts',
      'lib/tokens.ts',
      'lib/theme.ts',
      'lib/token-types.ts',
      'lib/browser.ts',
      'lib/node.ts',
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
      neverBundle: [/^\.\/chamele\.wasm/, /^node:/],
    },
  },
  // The themes barrel bundles (not unbundles) so every theme JSON is inlined
  // into one self-contained dist/themes.js; the raw JSON files are not
  // published.
  {
    entry: { themes: 'themes/index.ts' },
    tsconfig: './tsconfig.json',
    clean: false,
    dts: {
      sourcemap: true,
      tsgo: true,
    },
    platform: 'neutral',
  },
]);

export default config;
