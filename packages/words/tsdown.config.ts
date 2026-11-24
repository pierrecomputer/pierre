import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: [
      'lib/core.ts',
      'lib/core-entry.ts',
      'lib/index.ts',
      'lib/workerd.ts',
      'lib/no-math.ts',
      'lib/no-math-workerd.ts',
    ],
    clean: false,
    unbundle: true,
    platform: 'neutral',
    dts: { tsgo: true },
    deps: { neverBundle: [/^\.\/words(-no-math)?\.wasm/] },
  },
  {
    entry: {
      react: 'react/react.tsx',
      highlights: 'react/highlights.ts',
      html: 'html/index.ts',
      mermaid: 'html/mermaid.ts',
      // Only for the docs typecheck, through its project reference. Not published.
      'benchmark/fixtures/index': 'benchmark/fixtures/index.ts',
    },
    clean: false,
    platform: 'neutral',
    dts: { tsgo: true },
    deps: {
      neverBundle: [
        '@pierre/words',
        /^@pierre\/highlights(?:\/|$)/,
        'react',
        'react-dom',
        'react/jsx-runtime',
      ],
    },
  },
]);
