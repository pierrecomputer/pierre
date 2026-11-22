import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig[] = defineConfig([
  {
    // model/engine.ts types the store seam with @pierre/path-store shapes;
    // it is inlined into its importers so no emitted declaration names them.
    entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/model/engine.ts'],
    loader: {
      '.css': 'text',
    },
    tsconfig: './tsconfig.json',
    clean: true,
    dts: {
      sourcemap: true,
      tsgo: true,
    },
    unbundle: true,
    platform: 'neutral',
    deps: {
      alwaysBundle: [
        '@pierre/path-store',
        '@pierre/path-store-wat',
        '@pierre/theming',
      ],
    },
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
]);

export default config;
