import { defineConfig } from 'vite';
import type { ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig(({ mode }) => {
  const isReact = mode === 'react';

  const htmlPlugin = () => ({
    name: 'html-fallback',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/', async (req, res, next) => {
        if (req.url === '/' || req.url === '/index.html') {
          const htmlFile = isReact ? 'index-react.html' : 'index.html';
          const htmlPath = resolve(__dirname, htmlFile);
          try {
            const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            const html = await server.transformIndexHtml('/', htmlContent);
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
            return;
          } catch (e) {
            console.error('Error transforming HTML:', e);
          }
        }
        next();
      });
    },
  });

  if (isReact) {
    return {
      plugins: [react(), htmlPlugin()],
      build: {
        rollupOptions: {
          input: resolve(__dirname, 'index-react.html'),
        },
      },
    };
  }

  return {
    plugins: [htmlPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  };
});
