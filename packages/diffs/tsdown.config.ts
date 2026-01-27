import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { type UserConfig, defineConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: [
      'src/**/*.ts',
      'src/**/*.tsx',
      '!src/worker/worker.ts',
      '!src/worker/worker-portable.ts',
    ],
    loader: {
      '.css': 'text',
    },
    attw: process.env.ATTW === 'true',
    tsconfig: './tsconfig.json',
    clean: true,
    dts: {
      sourcemap: true,
      tsgo: true,
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
    entry: ['src/worker/worker.ts'],
    outDir: 'dist/worker',
    tsconfig: './tsconfig.json',
    clean: false,
    dts: { sourcemap: true, tsgo: true },
    platform: 'neutral',
  },
  {
    entry: ['src/worker/worker-portable.ts'],
    outDir: 'dist/worker',
    tsconfig: './tsconfig.json',
    clean: false,
    unbundle: false,
    noExternal: [/.*/],
    dts: { sourcemap: true, tsgo: true },
    platform: 'neutral',
    format: 'esm',
    treeshake: false,
  },
]);

export default config;
