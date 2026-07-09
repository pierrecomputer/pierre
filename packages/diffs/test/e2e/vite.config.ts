import { resolve } from 'node:path';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

const defaultPort = 4175;
const portFromEnv = Number(process.env.DIFFS_E2E_PORT);
const port = Number.isFinite(portFromEnv) ? portFromEnv : defaultPort;

const fixturesIndexPath = '/test/e2e/fixtures/index.html';

// Vite's startup banner only prints the server root, but the useful entry point
// is the fixture index that links to every fixture page. Append its full URL to
// the printed URLs so `moon run diffs:test-e2e-server` surfaces it directly.
function logFixturesIndex(): Plugin {
  return {
    name: 'diffs-e2e-fixtures-index-url',
    configureServer(server) {
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        console.log(
          `  \x1b[32m➜\x1b[0m  \x1b[1mFixtures:\x1b[0m http://127.0.0.1:${port}${fixturesIndexPath}`
        );
      };
    },
  };
}

// Serve the package root so fixtures can import the built library directly via
// `/dist/index.js` and `/dist/editor/index.js`. Vite resolves the bundle's bare
// dependency imports (shiki, etc.) from node_modules on the fly.
const config: UserConfig = defineConfig({
  root: resolve(import.meta.dirname, '..', '..'),
  plugins: [logFixturesIndex()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
});

export default config;
