import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { react: 'react/react.tsx', highlights: 'react/highlights.ts' },
  clean: false,
  platform: 'neutral',
  dts: { tsgo: true },
  deps: {
    neverBundle: [
      '@pierre/markdowns',
      '@pierre/highlights',
      'react',
      'react/jsx-runtime',
    ],
  },
});
