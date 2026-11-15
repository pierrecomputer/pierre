import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: ['src/index.ts', 'src/react/index.tsx'],
  // One output file for each source module, so that an app's bundler places
  // each part of the library in the chunk of its user. A shared file of the
  // two entries would put every part that a lazy chunk uses into the eager
  // chunk of an app that imports the root entry at once.
  unbundle: true,
  platform: 'neutral',
  // A module imports its sheet as a string with `?inline`; Lightning CSS
  // minifies the string, as an app build minifies a stylesheet.
  css: { minify: true },
  dts: { tsgo: true, sourcemap: true },
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
});

export default config;
