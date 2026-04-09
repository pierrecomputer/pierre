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

test('profile:pathstore CLI help advertises the expected workload/render workflow', () => {
  const result = Bun.spawnSync({
    cmd: ['bun', 'run', './scripts/profileTreesPathStore.ts', '--help'],
    cwd: packageRoot,
    env: createCommandEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr).trim();

  expect(result.exitCode).toBe(0);
  expect(stderr).toBe('');
  expect(stdout).toContain('bun ws trees profile:pathstore');
  expect(stdout).toContain('linux-5x');
  expect(stdout).toContain('path-store-profile.html');
});

test('profile:pathstore CLI rejects unknown workloads before browser setup', () => {
  const result = Bun.spawnSync({
    cmd: [
      'bun',
      'run',
      './scripts/profileTreesPathStore.ts',
      '--workload',
      'not-a-real-workload',
    ],
    cwd: packageRoot,
    env: createCommandEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr);

  expect(result.exitCode).not.toBe(0);
  expect(stdout).toBe('');
  expect(stderr).toContain("Invalid --workload value 'not-a-real-workload'");
});
