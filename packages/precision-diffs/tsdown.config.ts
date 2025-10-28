import { type UserConfig, defineConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: ['src/**/*.ts', 'src/**/*.tsx'],
    loader: { '.css': 'text' },
    attw: process.env.ATTW === 'true',
    tsconfig: './tsconfig.json',
    dts: {
      sourcemap: true,
    },
    unbundle: true,
    platform: 'neutral',
  },
]);

export default config;
