import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import { type UserConfig, defineConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: ['src/**/*.ts', 'src/**/*.tsx', '!src/react/FileTree.react.tsx'],
    loader: {
      '.css': 'text',
    },
    attw: process.env.ATTW === 'true',
    tsconfig: './tsconfig.json',
    clean: true,
    dts: {
      sourcemap: true,
    },
    unbundle: true,
    platform: 'neutral',
    // inputOptions: {
    //   transform: {
    //     jsx: {
    //       runtime: 'classic',
    //       importSource: 'preact',
    //       pragma: 'h',
    //       pragmaFrag: 'Fragment',
    //     },
    //   },
    // },
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
