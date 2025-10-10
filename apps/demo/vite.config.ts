import react from '@vitejs/plugin-react';
import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import path, { resolve } from 'path';
import { defineConfig } from 'vite';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

export default defineConfig(() => {
  const htmlPlugin = (): Plugin => ({
    name: 'html-fallback',
    configureServer(server: ViteDevServer) {
      const handleRoutes = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void
      ) => {
        // Handle root path - serve vanilla version
        if (req.url === '/' || req.url === '/index.html') {
          const htmlPath = resolve(__dirname, 'index.html');
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
      };

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      server.middlewares.use('/', handleRoutes);
    },
    configurePreviewServer(server: PreviewServer) {
      const handleRoutes = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void
        // eslint-disable-next-line @typescript-eslint/require-await
      ) => {
        // Handle root path - serve vanilla version
        if (req.url === '/' || req.url === '/index.html') {
          const htmlPath = resolve(__dirname, 'dist/index.html');
          try {
            const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
            res.setHeader('Content-Type', 'text/html');
            res.end(htmlContent);
            return;
          } catch (e) {
            console.error('Error serving HTML:', e);
          }
        }

        next();
      };

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      server.middlewares.use('/', handleRoutes);
    },
  });

  return {
    plugins: [react(), htmlPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
      },
    },
    resolve: {
      alias: {
        pierrejs: path.resolve(__dirname, './src/pierre-js/index.ts'),
      },
    },
  };
});
