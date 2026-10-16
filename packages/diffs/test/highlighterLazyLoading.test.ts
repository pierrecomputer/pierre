import { beforeAll, expect, test } from 'bun:test';

const entrypoints = [
  'packages/diffs/src/index.ts',
  'packages/diffs/src/edit/index.ts',
  'packages/diffs/src/react/index.ts',
  'packages/diffs/src/ssr/index.ts',
  'packages/diffs/src/worker/index.ts',
  'packages/diffs/src/worker/worker.ts',
  'packages/theming/src/themes.ts',
];
let outputs: NonNullable<Bun.BuildMetafile['outputs']>;

beforeAll(async () => {
  // Bun 1.4.0 resolves source modules differently inside its test runner; build in a clean runtime.
  const buildProcess = Bun.spawn(
    [
      process.execPath,
      '--eval',
      `
    const build = await Bun.build({
      entrypoints: ${JSON.stringify(entrypoints)},
      external: ['*.css?inline'],
      target: 'browser',
      splitting: true,
      metafile: true,
    });
    if (!build.success) throw new AggregateError(build.logs, 'Build failed');
    console.log(JSON.stringify(build.metafile));
  `,
    ],
    {
      cwd: new URL('../../..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  const [output, errors, exitCode] = await Promise.all([
    new Response(buildProcess.stdout).text(),
    new Response(buildProcess.stderr).text(),
    buildProcess.exited,
  ]);
  expect(errors).toBe('');
  expect(exitCode).toBe(0);
  const metadata: Bun.BuildMetafile = JSON.parse(output);
  if (metadata.outputs == null)
    throw new Error('Expected the emitted chunk graph');
  outputs = metadata.outputs;
});

// Follow emitted static chunks, including bundled workspace and npm dependencies.
test.each(entrypoints)('%s loads no syntax backend eagerly', (entrypoint) => {
  const entry = Object.keys(outputs).find((path) => {
    const source = outputs[path]?.entryPoint;
    return source === entrypoint || source?.endsWith(`/${entrypoint}`) === true;
  });
  if (entry == null)
    throw new Error(`Missing emitted entrypoint: ${entrypoint}`);
  const pending = [entry];
  const visited = new Set<string>();
  const eagerInputs = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const output = outputs[path];
    if (output == null) throw new Error(`Missing emitted chunk: ${path}`);
    for (const input of Object.keys(output.inputs)) eagerInputs.add(input);
    for (const dependency of output.imports) {
      if (dependency.kind === 'dynamic-import') continue;
      if ('external' in dependency && dependency.external === true)
        eagerInputs.add(dependency.path);
      else pending.push(dependency.path);
    }
  }
  expect(eagerInputs.size).toBeGreaterThan(5);
  expect(
    [...eagerInputs].filter((path) =>
      /(?:^|\/)(?:(?:shiki|@shikijs|highlights)(?:\/|$)|highlighter\/backends\/(?:shiki|highlights)\.)/.test(
        path
      )
    )
  ).toEqual([]);
});
