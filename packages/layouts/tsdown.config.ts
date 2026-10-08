import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: ['src/index.ts', 'src/react/index.tsx'],
  platform: 'neutral',
  dts: { tsgo: true, sourcemap: true },
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
});

export default config;
