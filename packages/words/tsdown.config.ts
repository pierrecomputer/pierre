import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['lib/core.ts', 'lib/index.ts', 'lib/workerd.ts'],
    clean: false,
    unbundle: true,
    platform: 'neutral',
    dts: { tsgo: true },
    deps: { neverBundle: [/^\.\/md\.wasm/] },
  },
  {
    entry: {
      react: 'react/react.tsx',
      highlights: 'react/highlights.ts',
      html: 'html/index.ts',
      'benchmark/fixtures': 'benchmark/fixtures.ts',
    },
    clean: false,
    platform: 'neutral',
    dts: { tsgo: true },
    deps: {
      neverBundle: [
        '@pierre/words',
        '@pierre/highlights',
        'react',
        'react/jsx-runtime',
      ],
    },
  },
]);
