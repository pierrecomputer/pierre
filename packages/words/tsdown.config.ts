import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    react: 'react/react.tsx',
    highlights: 'react/highlights.ts',
    html: 'html/index.ts',
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
});
