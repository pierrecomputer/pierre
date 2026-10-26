import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createStressFixture } from '../fixtures.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const inputStart = 65536;
let moduleId = 0;

const fixture = (name) =>
  readFileSync(new URL(`../fixtures/${name}.md`, import.meta.url), 'utf8');
const blocks = Array.from(
  { length: 32 },
  (_, i) =>
    `## Section ${i}\n\nA paragraph with **bold**, *emphasis*, and [a link](/docs/${i}).\n\n- One\n- Two\n\n`
).join('');
const unicode =
  '## 日本語 and café\n\n' +
  '中文 Ελληνικά العربية e\u0301 👩🏽‍💻 **太字** [資料](/資料).\n\n'.repeat(28);
const paragraph = 'A paragraph with **bold** words and `inline code`. '.repeat(
  96
);
const fence =
  'Before the code.\n\n```typescript\n' +
  Array.from(
    { length: 96 },
    (_, i) => `const value${i} = { name: "item ${i}", count: ${i} };\n`
  ).join('');
const definitions =
  blocks.slice(0, 1400) +
  '\n\nRead [the guide][guide] and the note[^note].\n\n' +
  '[guide]: /documentation "Guide"\n\n[^note]: A late note.\n\nAfter the definitions.\n';
const tables = Array.from(
  { length: 18 },
  (_, i) =>
    `| Item | Count |\n| :--- | ---: |\n| **row ${i}** | ${i} |\n\n- [x] Done\n- [ ] Pending\n  - Nested\n\n`
).join('');
const malformed =
  'Unclosed [label](https://example.com **bold `code <span title="unfinished\n\n'.repeat(
    40
  );

/** Prefixes use UTF-16 delivery boundaries, deliberately including split surrogates. */
function prefixes(source, step = 64) {
  const result = [];
  for (let end = step; end < source.length; end += step)
    result.push(source.slice(0, end));
  result.push(source);
  return result;
}

const recipes = [];
function add(id, workload, operation, load, description) {
  recipes.push({ id, workload, operation, load, description });
}
function staticCase(id, workload, operation, load, description) {
  add(id, workload, operation, () => ({ inputs: [load()] }), description);
}
function streamCase(id, workload, operation, source, description, step = 64) {
  add(
    id,
    workload,
    operation,
    () => ({ inputs: prefixes(source, step) }),
    description
  );
}

staticCase(
  'static-tiny',
  'tiny',
  'string-bytes',
  () => fixture('tiny'),
  'Real small Markdown document; string to borrowed HTML bytes.'
);
staticCase(
  'static-simd',
  'simd',
  'string-bytes',
  () => fixture('simd'),
  'Real medium Markdown document; string to borrowed HTML bytes.'
);
staticCase(
  'static-bytes',
  'simd',
  'bytes-bytes',
  () => fixture('simd'),
  'Pre-encoded medium document; copy to Wasm and return borrowed HTML bytes.'
);
staticCase(
  'static-string',
  'simd',
  'string-string',
  () => fixture('simd'),
  'Medium document including UTF-8 encode, render, and HTML decode.'
);
staticCase(
  'static-gfm',
  'gfm-spec',
  'string-bytes',
  () => fixture('gfm-spec'),
  'Optional large real GFM specification document.'
);
staticCase(
  'static-unicode',
  'unicode',
  'string-string',
  () => unicode,
  'Multibyte scripts, combining marks, and astral characters.'
);
staticCase(
  'static-malformed',
  'malformed-inline',
  'string-bytes',
  () => malformed,
  'Bounded malformed links, emphasis, code, and raw HTML.'
);
staticCase(
  'static-stress',
  'stress-100',
  'string-bytes',
  () => createStressFixture(100),
  'Optional existing 100-unit stress fixture, approximately 850 KB.'
);

for (const [workload, source, description] of [
  ['blocks', blocks, 'Completed headings, paragraphs, and lists'],
  ['paragraph', paragraph, 'One long unfinished paragraph'],
  ['fence', fence, 'One unfinished TypeScript fence'],
  ['definitions', definitions, 'Late reference and footnote definitions'],
]) {
  streamCase(
    `stream-${workload}-full`,
    workload,
    'replay-full',
    source,
    `${description}; direct full-prefix HTML replay.`
  );
  streamCase(
    `stream-${workload}-suffix`,
    workload,
    'session-suffix',
    source,
    `${description}; consume only new addition and pending suffix.`
  );
}
streamCase(
  'stream-blocks-session',
  'blocks',
  'session-full',
  blocks,
  'Same block deliveries, requesting full session HTML each time.'
);
streamCase(
  'stream-blocks-token',
  'blocks',
  'session-suffix',
  blocks,
  'Eight-UTF-16-unit deliveries expose token-sized update overhead.',
  8
);
streamCase(
  'stream-blocks-coarse',
  'blocks',
  'session-suffix',
  blocks,
  '1024-UTF-16-unit deliveries contrast update overhead with the same source.',
  1024
);
streamCase(
  'stream-unicode-suffix',
  'unicode',
  'session-suffix',
  unicode,
  'UTF-16 chunk boundaries can split astral characters; UTF-8 bytes vary.'
);
streamCase(
  'stream-tables-suffix',
  'tables-lists',
  'session-suffix',
  tables,
  'Growing GFM tables, task lists, and nested lists.'
);
streamCase(
  'stream-malformed-suffix',
  'malformed-inline',
  'session-suffix',
  malformed,
  'Incomplete inline and HTML recovery at delivery boundaries.'
);
add(
  'stream-repeated-suffix',
  'repeated',
  'session-suffix',
  () => ({
    inputs: prefixes(blocks).flatMap((input) => [input, input, input]),
  }),
  'Every prefix delivered three times; cached results must not append additions twice.'
);
add(
  'stream-edits-suffix',
  'edits-resets',
  'session-suffix',
  () => ({
    inputs: [
      'First\n\nTail',
      'First\n\nTail',
      'First\n\nTail grows',
      'First\n\nTail grows\n\nNext',
      'Replacement\n\n*unfinished',
      'Replacement\n\n*unfinished',
      '',
      'Restart\n\nUnicode 中 👩🏽‍💻',
      'Restart\n\nUnicode 中 👩🏽‍💻\n\n[later][id]',
      'Restart\n\nUnicode 中 👩🏽‍💻\n\n[later][id]\n\n[id]: /target',
    ],
    incomplete: [true, true, true, true, true, false, false, true, true, true],
  }),
  'Replacement, unchanged delivery, completion-mode change, empty reset, and late definition.'
);

staticCase(
  'kernel-encode',
  'unicode',
  'encode-into',
  () => unicode,
  'TextEncoder.encodeInto into a reusable preallocated buffer; no parser.'
);
staticCase(
  'kernel-copy',
  'simd',
  'input-copy',
  () => fixture('simd'),
  'Pre-encoded bytes copied into preallocated Wasm input memory; no parser.'
);
staticCase(
  'kernel-decode',
  'unicode',
  'decode',
  () => unicode,
  'Decode prepared rendered HTML bytes; parsing and encoding excluded.'
);
staticCase(
  'kernel-render',
  'blocks',
  'wasm-render',
  () => blocks,
  'Raw render export over preloaded input; ABI setup and borrowed-byte sampling included.'
);
staticCase(
  'kernel-complete',
  'open-emphasis',
  'wasm-complete',
  () => blocks + '**unfinished',
  'Raw completion export over preloaded open emphasis; original input ends in non-whitespace.'
);

export const defaultCaseIds = Object.freeze([
  'static-tiny',
  'static-bytes',
  'static-string',
  'stream-blocks-suffix',
  'stream-paragraph-suffix',
  'stream-fence-suffix',
  'stream-definitions-suffix',
  'stream-unicode-suffix',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function prepare(recipe) {
  const loaded = recipe.load();
  const inputs = loaded.inputs;
  const source = inputs.at(-1);
  const replay = ['replay-full', 'session-full', 'session-suffix'].includes(
    recipe.operation
  );
  const options = inputs.map((_, i) => ({
    incomplete: replay ? (loaded.incomplete?.[i] ?? true) : false,
    skipHtml: replay,
  }));
  return {
    inputs,
    source,
    options,
    descriptor: {
      id: recipe.id,
      workload: recipe.workload,
      operation: recipe.operation,
      unit: replay
        ? 'replay'
        : recipe.id.startsWith('kernel-')
          ? 'kernel'
          : 'document',
      inputBytes: Buffer.byteLength(source),
      inputUnits: source.length,
      submittedBytes: inputs.reduce(
        (sum, input) => sum + Buffer.byteLength(input),
        0
      ),
      updates: inputs.length,
      fixtureSha256: sha256(
        JSON.stringify(inputs.map((input, i) => [input, options[i]]))
      ),
      sourceSha256: sha256(source),
      description: recipe.description,
    },
  };
}

/** Serializable metadata; no Wasm loading, compilation, or execution. */
export function listCases() {
  return recipes.map((recipe) => prepare(recipe).descriptor);
}

// Sample length and three positions: observable consumption without a hash-sized scan.
function consumeBytes(bytes) {
  const n = bytes.length;
  return (
    (n ^
      (bytes[0] ?? 0) ^
      ((bytes[n >>> 1] ?? 0) << 8) ^
      ((bytes[n - 1] ?? 0) << 16)) >>>
    0
  );
}
function consumeString(text) {
  const n = text.length;
  return (
    (n ^
      text.charCodeAt(0) ^
      (text.charCodeAt(n >>> 1) << 8) ^
      (text.charCodeAt(n - 1) << 16)) >>>
    0
  );
}
function mix(checksum, value) {
  return (Math.imul(checksum, 33) ^ value) >>> 0;
}

/** Length framing distinguishes deliveries, including empty output, without concatenation ambiguity. */
function outputDigest() {
  const hash = createHash('sha256');
  let outputBytes = 0;
  let deliveries = 0;
  return {
    add(value) {
      const bytes = typeof value === 'string' ? Buffer.from(value) : value;
      hash.update(`${bytes.byteLength}:`);
      hash.update(bytes);
      outputBytes += bytes.byteLength;
      deliveries++;
    },
    finish() {
      return { outputSha256: hash.digest('hex'), outputBytes, deliveries };
    },
  };
}

/** Import each target's glue into a private module, never the package singleton. */
async function loadTarget(
  targetDirectory,
  { wasmFile = 'md.wasm', imports } = {}
) {
  let glue = await readFile(join(targetDirectory, 'index.mjs'), 'utf8');
  if (imports) {
    const anchor = 'new WebAssembly.Instance(wasmModule, {})';
    assert.equal(
      glue.split(anchor).length,
      2,
      'Diagnostic import adaptation requires the known Renderer constructor'
    );
    glue = glue.replace(
      anchor,
      'new WebAssembly.Instance(wasmModule, labImports)'
    );
    glue +=
      '\nlet labImports;\nexport function setLabImports(value) { labImports = value; }\n';
  }
  const url = `data:text/javascript;base64,${Buffer.from(glue).toString('base64')}#words-lab-${moduleId++}`;
  const api = await import(url);
  if (imports) api.setLabImports(imports);
  const wasmModule = await WebAssembly.compile(
    await readFile(join(targetDirectory, wasmFile))
  );
  return { api, renderer: api.init(wasmModule) };
}

/**
 * One run is one document, complete fresh-session replay, or isolated kernel.
 * Verification is deliberately separate: full hashes and parity never enter run().
 * Diagnostic options: wasmFile, imports, observeSession({input, options, result, cached}).
 */
export async function createCase(id, targetDirectory, configuration = {}) {
  const recipe = recipes.find((candidate) => candidate.id === id);
  if (!recipe) throw new RangeError(`Unknown words measurement case: ${id}`);
  const { descriptor, source, inputs, options } = prepare(recipe);
  const { api, renderer } = await loadTarget(targetDirectory, configuration);
  const bytes = encoder.encode(source);
  const operation = recipe.operation;
  const sessionFactory = configuration.observeSession
    ? () => {
        const session = api.createHtmlSession();
        let previous;
        return {
          render(input, flags) {
            const result = session.render(input, flags);
            configuration.observeSession({
              input,
              options: flags,
              result,
              cached: result === previous,
            });
            previous = result;
            return result;
          },
        };
      }
    : () => api.createHtmlSession();
  const direct = (input, flags) =>
    decoder.decode(api.renderToHtml(input, flags));
  let run;
  let verify;

  if (operation === 'session-full' || operation === 'session-suffix') {
    const full = operation === 'session-full';
    run = () => {
      const session = sessionFactory();
      let checksum = 0;
      let previous;
      for (let i = 0; i < inputs.length; i++) {
        const result = session.render(inputs[i], options[i]);
        if (full) checksum = mix(checksum, consumeString(result.html));
        else {
          if (result !== previous)
            checksum = mix(checksum, consumeString(result.addition));
          checksum = mix(checksum, consumeString(result.pending));
        }
        previous = result;
      }
      return checksum;
    };
    verify = () => {
      const digest = outputDigest();
      const session = sessionFactory();
      const retained = [];
      let stable = '';
      let previous;
      for (let i = 0; i < inputs.length; i++) {
        const result = session.render(inputs[i], options[i]);
        const cached = result === previous;
        if (!cached) {
          assert.equal(
            result.revision,
            (previous?.revision ?? 0) + 1,
            `${id}: revision at update ${i}`
          );
          stable = (result.reset ? '' : stable) + result.addition;
        }
        assert.equal(
          stable,
          result.stable,
          `${id}: stable prefix at update ${i}`
        );
        const actual = stable + result.pending;
        // Decode each borrowed direct output before the next renderer call.
        const expected = direct(inputs[i], options[i]);
        assert.equal(
          actual,
          expected,
          `${id}: session/direct parity at update ${i}`
        );
        assert.equal(result.html, expected, `${id}: full HTML at update ${i}`);
        // Check checkpoint invariants above, but hash semantic HTML so a valid
        // optimization may choose different stable/pending partitions.
        digest.add(actual);
        retained.push([result, expected]);
        previous = result;
      }
      for (const [result, expected] of retained)
        assert.equal(result.html, expected, `${id}: retained result changed`);
      return digest.finish();
    };
  } else if (operation === 'replay-full') {
    run = () => {
      let checksum = 0;
      for (let i = 0; i < inputs.length; i++)
        checksum = mix(checksum, consumeString(direct(inputs[i], options[i])));
      return checksum;
    };
    verify = () => {
      const digest = outputDigest();
      for (let i = 0; i < inputs.length; i++)
        digest.add(direct(inputs[i], options[i]));
      return digest.finish();
    };
  } else {
    let produce;
    let expected;
    let check;
    if (operation === 'encode-into') {
      const destination = new Uint8Array(bytes.length);
      let encoded;
      produce = () => {
        encoded = encoder.encodeInto(source, destination);
        return destination;
      };
      expected = bytes;
      check = () => {
        assert.equal(encoded.read, source.length);
        assert.equal(encoded.written, bytes.length);
      };
    } else if (operation === 'input-copy') {
      renderer.grow(bytes.length + 8192);
      produce = () => {
        renderer.buffer.set(bytes, inputStart);
        return renderer.buffer.subarray(inputStart, inputStart + bytes.length);
      };
      expected = bytes;
    } else if (operation === 'decode') {
      const html = api.renderToHtml(source).slice();
      descriptor.kernelInputBytes = html.length;
      produce = () => decoder.decode(html);
      expected = decoder.decode(html);
    } else if (operation === 'wasm-render' || operation === 'wasm-complete') {
      renderer.grow(bytes.length + 8192);
      const preload = () => {
        renderer.buffer.set(bytes, inputStart);
        renderer.buffer.fill(
          0,
          inputStart + bytes.length,
          inputStart + bytes.length + 32
        );
      };
      const controls = () => {
        renderer.dv.setUint8(0, 0);
        renderer.dv.setUint8(1, 0);
        renderer.dv.setUint32(2, bytes.length, true);
        renderer.dv.setUint32(22, 0, true);
      };
      preload();
      if (operation === 'wasm-render') {
        produce = () => {
          controls();
          try {
            renderer.wasmRender();
          } finally {
            renderer.bindMemory();
          }
          const start = renderer.dv.getUint32(6, true);
          return renderer.buffer.subarray(
            start,
            start + renderer.dv.getUint32(10, true)
          );
        };
        expected = api.renderToHtml(source).slice();
        preload();
        check = () =>
          assert.deepEqual(
            renderer.buffer.subarray(inputStart, inputStart + bytes.length),
            bytes,
            'Raw render mutated preloaded input'
          );
      } else {
        // Completion only appends for this fixture: no whitespace shift, truncation,
        // or overwritten authored suffix. Restoring the original EOF is sufficient.
        produce = () => {
          controls();
          const length = renderer.wasmComplete();
          renderer.bindMemory();
          return renderer.buffer.subarray(inputStart, inputStart + length);
        };
        expected = encoder.encode(source + '**');
        check = () =>
          assert.deepEqual(
            renderer.buffer.subarray(inputStart, inputStart + bytes.length),
            bytes,
            'Completion mutated authored input; this fixture is not safe to preload'
          );
      }
    } else {
      const input = operation === 'bytes-bytes' ? bytes : source;
      produce =
        operation === 'string-string'
          ? () => direct(input)
          : () => api.renderToHtml(input);
    }
    run = () => {
      const result = produce();
      return typeof result === 'string'
        ? consumeString(result)
        : consumeBytes(result);
    };
    verify = () => {
      const digest = outputDigest();
      // A second delivery detects unstable raw-preloaded kernels and reused memory.
      for (let i = 0; i < 2; i++) {
        const result = produce();
        if (expected !== undefined) {
          if (typeof result === 'string') assert.equal(result, expected);
          else assert.deepEqual(result, expected);
        }
        check?.();
        digest.add(result);
      }
      return digest.finish();
    };
  }
  return { descriptor, run, verify, renderer, api, source, inputs };
}
