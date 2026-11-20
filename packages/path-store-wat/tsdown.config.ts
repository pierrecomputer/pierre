import { defineConfig, type UserConfig } from 'tsdown';

// scripts/build.ts emits path-store.wasm and path-store.wasm.mjs into dist/
// before tsdown runs (see moon.yml); keep the ./path-store.wasm* imports as-is
// so the glue resolves them next to itself at runtime.
const config: UserConfig[] = defineConfig([
  {
    entry: [
      'lib/index.ts',
      'lib/workerd.ts',
      'lib/store.ts',
      'lib/engine.ts',
      'lib/events.ts',
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
      neverBundle: [/^\.\/path-store\.wasm/, '@pierre/path-store'],
    },
  },
]);

export default config;
