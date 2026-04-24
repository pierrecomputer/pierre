import autoprefixer from 'autoprefixer';
import { transform as transformCSS } from 'lightningcss';
import postcss from 'postcss';
import postcssCalc from 'postcss-calc';
import postcssNesting from 'postcss-nesting';
import { defineConfig, type UserConfig } from 'tsdown';

const LAYER_ORDER = '@layer base,theme,rendered,unsafe;';

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
        name: 'postcss-diffs-css',
        async transform(code, id) {
          if (!id.endsWith('.css')) return;

          const result = await postcss([
            postcssNesting(),
            postcssCalc({
              preserve: false,
              precision: 5,
              warnWhenCannotResolve: false,
            }),
            autoprefixer,
          ]).process(code, {
            from: id,
            map: false,
          });

          const minified = transformCSS({
            filename: id,
            code: Buffer.from(result.css),
            minify: true,
          });
          const minifiedCSS = minified.code.toString();

          return {
            code: minifiedCSS.startsWith(LAYER_ORDER)
              ? minifiedCSS
              : `${LAYER_ORDER}${minifiedCSS}`,
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
