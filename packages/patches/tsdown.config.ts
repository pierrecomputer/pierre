import { defineConfig, type UserConfig } from 'tsdown';

// scripts/build.ts writes dist/patch.wasm and dist/patch.wasm.mjs before
// tsdown runs (see moon.yml); keep the ./patch.wasm* imports as-is so they
// resolve next to the glue at runtime.
const config: UserConfig = defineConfig({
  entry: ['lib/core.ts', 'lib/index.ts', 'lib/workerd.ts'],
  tsconfig: './tsconfig.json',
  clean: false,
  dts: {
    sourcemap: true,
    tsgo: true,
  },
  unbundle: true,
  platform: 'neutral',
  deps: {
    neverBundle: [/^\.\/patch\.wasm/],
  },
});

export default config;
