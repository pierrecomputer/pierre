import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: ['src/**/*.ts', 'src/**/*.tsx', 'src/style.css'],
    attw: process.env.ATTW === 'true',
    tsconfig: './tsconfig.json',
    clean: true,
    dts: {
      sourcemap: true,
      tsgo: true,
    },
    unbundle: true,
    platform: 'neutral',
    copy: [
      {
        from: 'src/style.css',
        to: 'dist/style.css',
      },
    ],
  },
]);

export default config;
