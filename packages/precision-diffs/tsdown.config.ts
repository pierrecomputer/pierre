import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { type UserConfig, defineConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/worker/shiki-worker.ts'],
    loader: {
      '.css': 'text',
    },
    attw: process.env.ATTW === 'true',
    tsconfig: './tsconfig.json',
    clean: false,
    dts: {
      sourcemap: true,
    },
    unbundle: true,
    platform: 'neutral',
    plugins: [
      {
        name: 'postcss-autoprefixer',
        async transform(code, id) {
          if (!id.endsWith('.css')) return;

          const result = await postcss([autoprefixer]).process(code, {
            from: id,
            map: false,
          });

          return {
            code: result.css,
            map: null,
          };
        },
      },
    ],
  },
  {
    entry: ['src/worker/shiki-worker.ts'],
    outDir: 'dist/worker',
    tsconfig: './tsconfig.json',
    clean: false,
    dts: {
      sourcemap: true,
    },
    platform: 'neutral',
  },
]);

export default config;
