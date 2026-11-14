import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: [
    'src/index.ts',
    'src/react/index.tsx',
    'src/overlays/index.ts',
    'src/react/overlays.tsx',
  ],
  platform: 'neutral',
  // A module imports its sheet as a string with `?inline`; Lightning CSS
  // minifies the string, as an app build minifies a stylesheet.
  css: { minify: true },
  dts: { tsgo: true, sourcemap: true },
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
});

export default config;
