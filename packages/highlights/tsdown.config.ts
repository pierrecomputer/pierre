import { execFileSync } from 'node:child_process';
import { defineConfig, type UserConfig } from 'tsdown';

// The two configs share dist/, so neither may clean the other's output.
// scripts/build.ts emits highlights.wasm and highlights.wasm.mjs after tsdown runs;
// keep ./highlights.wasm* imports as-is for runtime resolution next to the glue.
const config: UserConfig[] = defineConfig([
  {
    entry: [
      'lib/index.ts',
      'lib/highlighter.ts',
      'lib/live.ts',
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
      neverBundle: [/^\.\/highlights\.wasm/, /^node:/],
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
    hooks: {
      'build:done': () => {
        execFileSync('bun', ['./scripts/build.ts'], {
          cwd: import.meta.dirname,
          stdio: 'inherit',
        });
      },
    },
  },
]);

export default config;
