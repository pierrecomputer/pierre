import react from '@vitejs/plugin-react';
import fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import path, { resolve } from 'path';
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { createLogger, defineConfig, type Logger } from 'vite';

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeFilteredLogger(folder: string): Logger {
  const base = createLogger();

  const folderPattern = escapeRegExp(path.normalize(folder)).replace(
    /\\+/g,
    '[\\\\/]+'
  );

  const noisyMsg = new RegExp(`page reload\\b[\\s\\S]*${folderPattern}`, 'i');

  const passthrough = <T extends keyof Logger>(m: T) =>
    // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-return
    ((...args: any[]) => (base[m] as any)(...args)) as Logger[T];

  return {
    ...base,
    info(msg, opts) {
      if (msg.includes('packages/diffs/dist/index.js')) {
        base.info(
          '\x1b[32mpage reload\x1b[0m @pierre/diffs update detected',
          opts
        );
      } else if (noisyMsg.test(msg)) {
        return;
      } else {
        base.info(msg, opts);
      }
    },
    // everything else passes through
    warn: passthrough('warn'),
    error: passthrough('error'),
    warnOnce: passthrough('warnOnce'),
    clearScreen: passthrough('clearScreen'),
    hasWarned: base.hasWarned,
    // oxlint-disable-next-line typescript/no-explicit-any
    hasErrorLogged: (base as any).hasErrorLogged,
  };
}

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

      // oxlint-disable-next-line typescript/no-misused-promises
      server.middlewares.use('/', handleRoutes);
    },
    configurePreviewServer(server: PreviewServer) {
      const handleRoutes = async (
        req: IncomingMessage,
        res: ServerResponse,
        next: () => void
        // oxlint-disable-next-line typescript/require-await
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

      // oxlint-disable-next-line typescript/no-misused-promises
      server.middlewares.use('/', handleRoutes);
    },
  });

  return {
    plugins: [react(), htmlPlugin()],
    customLogger: makeFilteredLogger('packages/diffs'),
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
      },
    },
  };
});
