import { type UserConfig, defineConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: ['src/**/*.ts', '!src/**/*.test.ts'],
    loader: { '.css': 'text' },
    attw: process.env.ATTW === 'true',
    tsconfig: './tsconfig.json',
    clean: false,
    dts: {
      sourcemap: true,
    },
    unbundle: true,
    platform: 'neutral',
  },
]);

export default config;
