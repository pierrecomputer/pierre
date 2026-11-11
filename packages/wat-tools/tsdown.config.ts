import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
  entry: ['index.ts', 'core.ts', 'highlights.ts'],
  tsconfig: './tsconfig.json',
  dts: { sourcemap: true, tsgo: true },
  unbundle: true,
  platform: 'node',
  fixedExtension: false,
});

export default config;
