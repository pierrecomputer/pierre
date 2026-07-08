import { defineConfig } from 'vite';

// Two build flavors:
//  - default: the npm library (dist/canvas-pipes.js + type declarations)
//  - --mode site: the demo page as a static site (site/), for deployment
export default defineConfig(({ mode }) =>
  mode === 'site'
    ? {
        build: {
          outDir: 'site',
        },
      }
    : {
        build: {
          lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            fileName: 'canvas-pipes',
          },
        },
      },
);
