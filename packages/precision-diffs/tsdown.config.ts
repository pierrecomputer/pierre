import autoprefixer from 'autoprefixer';
import { writeFileSync } from 'fs';
import { join } from 'path';
import postcss from 'postcss';
import { type UserConfig, defineConfig } from 'tsdown';

const config: UserConfig = defineConfig([
  {
    entry: ['src/**/*.ts', 'src/**/*.tsx'],
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

          // Also write the processed CSS to dist/style.css for inspection
          if (id.endsWith('src/style.css')) {
            writeFileSync(join(process.cwd(), 'dist/style.css'), result.css);
          }

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
