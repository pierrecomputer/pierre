import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
let pending = true;
let generate = true;
let running = false;
let stopped = false;
let child: Bun.Subprocess | undefined;
let files: Map<string, number> | undefined;

/** Serialize generation and bundling so consumers never see glue ahead of its Wasm ABI. */
async function rebuild(): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    while (pending && !stopped) {
      pending = false;
      const compile = generate;
      generate = false;
      if (compile) {
        child = Bun.spawn([process.execPath, './scripts/build.ts'], {
          cwd,
          stdout: 'inherit',
          stderr: 'inherit',
        });
        if ((await child.exited) !== 0) {
          generate = true;
          continue;
        }
      }
      if (stopped) break;
      child = Bun.spawn(['tsdown', '--no-clean', '--log-level', 'error'], {
        cwd,
        stdout: 'inherit',
        stderr: 'inherit',
      });
      await child.exited;
    }
  } catch (error) {
    console.error(error);
  } finally {
    child = undefined;
    running = false;
  }
}

/** Poll source metadata so edits also rebuild on filesystems without watch events. */
function poll(): void {
  const paths = ['tsdown.config.ts', 'tsconfig.json'];
  for (const dir of ['src', 'lib', 'themes', 'scripts']) {
    for (const name of readdirSync(`${cwd}/${dir}`, {
      recursive: true,
      encoding: 'utf8',
    })) {
      if (!/\.(wat|ts|json)$/.test(name)) continue;
      if (
        dir === 'lib' &&
        (name === 'token-types.ts' || name === 'languages.ts')
      )
        continue;
      paths.push(`${dir}/${name}`);
    }
  }
  const next = new Map<string, number>();
  for (const path of paths) {
    const stat = statSync(`${cwd}/${path}`, { throwIfNoEntry: false });
    if (stat !== undefined) next.set(path, stat.mtimeMs);
  }
  if (files !== undefined) {
    for (const path of new Set([...files.keys(), ...next.keys()])) {
      if (files.get(path) === next.get(path)) continue;
      pending = true;
      generate ||= /^(src|themes|scripts)\//.test(path);
    }
  }
  files = next;
  if (pending) void rebuild();
}

const interval = setInterval(poll, 500);

/** Close watchers and terminate the current build when Moon stops this task. */
function stop(): void {
  stopped = true;
  clearInterval(interval);
  child?.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
poll();
