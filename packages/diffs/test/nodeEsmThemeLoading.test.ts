import { beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIndexPath = join(packageDir, 'dist', 'index.js');
const distSSRIndexPath = join(packageDir, 'dist', 'ssr', 'index.js');

// Rebuild once for this file so the Node checks always validate fresh output
// from the current branch rather than any previously generated dist/.
function buildDist(): void {
  execFileSync('bun', ['run', 'build'], {
    cwd: packageDir,
    env: {
      ...process.env,
      AGENT: '1',
    },
    stdio: 'inherit',
  });
}

// Execute the built entrypoint with Node to catch runtime-only ESM issues that
// Bun's test runner will not surface.
function runNodeModule(modulePath: string, body: string): string {
  const moduleUrl = pathToFileURL(modulePath).href;

  return execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import * as mod from ${JSON.stringify(moduleUrl)};\n${body}`,
    ],
    {
      cwd: packageDir,
      env: {
        ...process.env,
        AGENT: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
      encoding: 'utf8',
    }
  );
}

describe('built Node ESM theme loading', () => {
  beforeAll(() => {
    buildDist();
  });

  test(
    'loads pierre-light through resolveTheme',
    () => {
      const output = runNodeModule(
        distIndexPath,
        `const theme = await mod.resolveTheme('pierre-light');
console.log(theme.name);`
      );

      expect(output.trim()).toBe('pierre-light');
    },
    { timeout: 20_000 }
  );

  test(
    'loads pierre-dark through the SSR entrypoint',
    () => {
      const output = runNodeModule(
        distSSRIndexPath,
        `const result = await mod.preloadFile({
  file: {
    name: 'example.ts',
    contents: 'export const x = 1;\\n',
  },
  options: {
    theme: 'pierre-dark',
  },
});
console.log(result.prerenderedHTML.length > 0 ? 'ok' : 'empty');`
      );

      expect(output.trim()).toBe('ok');
    },
    { timeout: 20_000 }
  );
});
