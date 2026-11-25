import { expect, test } from 'bun:test';

test('import compiles no Wasm; the first call reports a compile error', () => {
  // A child process, so the stub cannot leak into the shared highlighter.
  const result = Bun.spawnSync([
    process.execPath,
    '--eval',
    `
    const Module = WebAssembly.Module;
    WebAssembly.Module = function () {
      throw new WebAssembly.CompileError('Wasm SIMD unsupported');
    };
    const { codeToHtml, pierreDark: theme } = await import('@pierre/highlights');
    const results = [];
    try { codeToHtml('a', { lang: 'js', theme }); } catch (e) { results.push(e.message); }
    WebAssembly.Module = Module;
    results.push(new TextDecoder().decode(codeToHtml('a', { lang: 'js', theme })).startsWith('<pre'));
    console.log(JSON.stringify(results));
    `,
  ]);
  expect(result.stderr.toString()).toBe('');
  expect(JSON.parse(result.stdout.toString())).toEqual([
    'Wasm SIMD unsupported',
    true,
  ]);
});
