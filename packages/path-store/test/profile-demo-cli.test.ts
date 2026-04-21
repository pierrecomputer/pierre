import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));

function createCommandEnv(): Record<string, string> {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] != null
    )
  );
  env.AGENT = '1';
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  return env;
}

test('profile:demo CLI help reflects worktree-aware default ports', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './scripts/profileDemo.ts', '--help'],
    cwd: packageRoot,
    env: {
      ...createCommandEnv(),
      PIERRE_PORT_OFFSET: '30',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr).trim();

  expect(result.exitCode).toBe(0);
  expect(stderr).toBe('');
  expect(stdout).toContain('default: http://127.0.0.1:9252');
  expect(stdout).toContain('default: http://127.0.0.1:4205/');
});
