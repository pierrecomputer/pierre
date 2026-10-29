import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createStressFixture } from '../fixtures.mjs';
import { randomGenerator } from './statistics.mjs';

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
// Hand-written assistant-style responses: mixed headings, nested and task lists,
// fences in several languages, a table, blockquote, links, footnote, non-ASCII.
const assistant = fixture('assistant-explain');
const review = fixture('assistant-review');
const frontmatter =
  '---\ntitle: Retry policy\ntags:\n  - http\n  - resilience\ndraft: false\n---\n' +
  assistant;

/** Prefixes use UTF-16 delivery boundaries, deliberately including split surrogates. */
function prefixes(source, step = 64) {
  const result = [];
  for (let end = step; end < source.length; end += step)
    result.push(source.slice(0, end));
  result.push(source);
  return result;
}

/**
 * Seeded variable-size deliveries. `token` approximates a token stream
 * (1–12 UTF-16 units, skewed small, mean ≈ 4.3); `chunk` approximates
 * network-batched deliveries (16–96 units). Same seed, same boundaries.
 */
const chunkSizers = {
  token: (random) => 1 + Math.floor(random() * random() * 12),
  chunk: (random) => 16 + Math.floor(random() * 81),
};
export function seededPrefixes(source, style, seed = 20261026) {
  const sizer = chunkSizers[style];
  if (!sizer) throw new RangeError(`Unknown delivery style: ${style}`);
  const random = randomGenerator(seed);
  const result = [];
  for (let end = sizer(random); end < source.length; end += sizer(random))
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
function seededCase(
  id,
  workload,
  operation,
  source,
  style,
  description,
  extra
) {
  add(
    id,
    workload,
    operation,
    () => ({ inputs: seededPrefixes(source, style), ...extra }),
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
staticCase(
  'static-assistant',
  'assistant-explain',
  'string-bytes',
  () => assistant,
  'Assistant-style explanation with fences, table, lists, and links; string to HTML bytes.'
);
add(
  'static-frontmatter',
  'assistant-frontmatter',
  'string-frontmatter',
  () => ({ inputs: [frontmatter], frontmatter: true }),
  'YAML frontmatter parsed to JSON plus the assistant document as HTML.'
);
add(
  'static-ansi',
  'simd',
  'string-ansi',
  () => ({ inputs: [fixture('simd')], width: 0 }),
  'Real medium document through the ANSI backend, no wrapping.'
);
add(
  'static-ansi-assistant',
  'assistant-explain',
  'string-ansi',
  () => ({ inputs: [assistant], width: 0 }),
  'Assistant document through the ANSI backend, no wrapping.'
);
add(
  'static-ansi-wrap',
  'assistant-explain',
  'string-ansi',
  () => ({ inputs: [assistant], width: 80 }),
  'Assistant document through the ANSI backend wrapped at 80 columns.'
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
for (const [workload, source, description] of [
  ['assistant', assistant, 'Assistant explanation'],
  ['review', review, 'Assistant code review'],
]) {
  for (const style of ['token', 'chunk'])
    seededCase(
      `stream-${workload}-${style}`,
      `${workload}-${style}`,
      'session-suffix',
      source,
      style,
      `${description}; seeded ${style}-sized deliveries; consume addition and pending suffix.`
    );
}
for (const [workload, source, description] of [
  ['assistant', assistant, 'Assistant explanation'],
  ['review', review, 'Assistant code review'],
]) {
  for (const style of ['token', 'chunk'])
    seededCase(
      `html-${workload}-${style}`,
      `${workload}-${style}`,
      'html-renderer',
      source,
      style,
      `${description}; createHtmlRenderer with default options over seeded ${style}-sized deliveries.`,
      { htmlVariant: 'default' }
    );
}
seededCase(
  'html-assistant-hooks',
  'assistant-chunk',
  'html-renderer',
  assistant,
  'chunk',
  'Assistant explanation; createHtmlRenderer with an element hook and inline-code hook.',
  { htmlVariant: 'hooks' }
);
add(
  'html-fence-chunk',
  'fence-chunk',
  'html-renderer',
  () => {
    const deliveries = seededPrefixes(fence, 'chunk');
    return {
      inputs: [...deliveries, fence],
      incomplete: [...deliveries.map(() => true), false],
      active: [...deliveries.map(() => true), false],
      htmlVariant: 'default',
    };
  },
  'Open TypeScript fence with explicit settlement; active streaming attributes are removed.'
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

/** Named option sets keep html cases serializable and comparable across captures. */
const htmlVariants = {
  default: () => ({}),
  hooks: () => ({
    components: {
      a: (html) => html.replace('<a ', '<a class="message-link" '),
      inlineCode: (html) => html,
    },
  }),
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function prepare(recipe) {
  const loaded = recipe.load();
  const inputs = [...loaded.inputs];
  const source = inputs.at(-1);
  const replay = [
    'replay-full',
    'session-full',
    'session-suffix',
    'html-renderer',
  ].includes(recipe.operation);
  const options = inputs.map((_, i) => ({
    incomplete: replay ? (loaded.incomplete?.[i] ?? true) : false,
    skipHtml: replay,
    ...(recipe.operation === 'html-renderer'
      ? { active: loaded.active?.[i] ?? true }
      : {}),
  }));
  const lastOptions = options.at(-1);
  const settlementAppended =
    replay && (lastOptions.incomplete || lastOptions.active === true);
  if (settlementAppended) {
    inputs.push(source);
    options.push({
      ...lastOptions,
      incomplete: false,
      ...(recipe.operation === 'html-renderer' ? { active: false } : {}),
    });
  }
  // Run-length modes preserve explicit authored transitions without repeating
  // flags for every token-sized delivery in serialized descriptors.
  const deliveryModes = [];
  for (const { incomplete, active } of options) {
    const previous = deliveryModes.at(-1);
    if (previous?.incomplete === incomplete && previous?.active === active) {
      previous.updates++;
    } else {
      deliveryModes.push({
        updates: 1,
        incomplete,
        ...(active !== undefined ? { active } : {}),
      });
    }
  }
  const settings = {
    ...(loaded.width !== undefined ? { width: loaded.width } : {}),
    ...(loaded.frontmatter ? { frontmatter: true } : {}),
    ...(loaded.htmlVariant ? { htmlVariant: loaded.htmlVariant } : {}),
  };
  if (loaded.htmlVariant && !htmlVariants[loaded.htmlVariant])
    throw new RangeError(`Unknown html variant: ${loaded.htmlVariant}`);
  return {
    inputs,
    source,
    options,
    settings,
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
      lifecycle: replay ? 'stream-to-settled' : 'settled',
      settlementAppended,
      deliveryModes,
      ...settings,
      fixtureSha256: sha256(
        JSON.stringify([
          inputs.map((input, i) => [input, options[i]]),
          settings,
          replay ? 'stream-to-settled' : 'settled',
        ])
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

// Sample length and three positions: observable consumption without a hash-sized
// scan. Empty values short-circuit; an out-of-bounds index deoptimizes the
// consumer and perturbs the measured loop.
function consumeBytes(bytes) {
  const n = bytes.length;
  if (n === 0) return 0;
  return (n ^ bytes[0] ^ (bytes[n >>> 1] << 8) ^ (bytes[n - 1] << 16)) >>> 0;
}
function consumeString(text) {
  const n = text.length;
  if (n === 0) return 0;
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
  let intermediate = hash.copy();
  let finalOutputSha256;
  return {
    add(value) {
      const bytes = typeof value === 'string' ? Buffer.from(value) : value;
      intermediate = hash.copy();
      finalOutputSha256 = sha256(bytes);
      hash.update(`${bytes.byteLength}:`);
      hash.update(bytes);
      outputBytes += bytes.byteLength;
      deliveries++;
    },
    finish() {
      return {
        outputSha256: hash.digest('hex'),
        intermediateOutputSha256: intermediate.digest('hex'),
        finalOutputSha256,
        outputBytes,
        deliveries,
      };
    },
  };
}

/**
 * Import each target's glue into a private module, never the package singleton.
 * html cases load the capture's bundled html.mjs, which inlines the same glue.
 */
async function loadTarget(
  targetDirectory,
  { wasmFile = 'md.wasm', imports, entry = 'index.mjs' } = {}
) {
  let glue = await readFile(join(targetDirectory, entry), 'utf8');
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
  const { descriptor, source, inputs, options, settings } = prepare(recipe);
  const entry = recipe.operation === 'html-renderer' ? 'html.mjs' : 'index.mjs';
  const { api, renderer } = await loadTarget(targetDirectory, {
    ...configuration,
    entry,
  });
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

  if (operation === 'html-renderer') {
    const htmlOptions = htmlVariants[settings.htmlVariant];
    run = () => {
      const formatter = api.createHtmlRenderer(htmlOptions());
      let checksum = 0;
      let previous;
      for (let i = 0; i < inputs.length; i++) {
        const result = formatter.render(
          inputs[i],
          options[i].incomplete,
          options[i].active
        );
        if (result !== previous)
          checksum = mix(checksum, consumeString(result.addition));
        checksum = mix(checksum, consumeString(result.pending));
        previous = result;
      }
      formatter.dispose();
      return checksum;
    };
    // Formatting hooks make direct parity impossible; check the checkpoint
    // contract the DOM renderer relies on and hash every delivered document.
    verify = () => {
      const digest = outputDigest();
      const formatter = api.createHtmlRenderer(htmlOptions());
      let stable = '';
      let previous;
      for (let i = 0; i < inputs.length; i++) {
        const result = formatter.render(
          inputs[i],
          options[i].incomplete,
          options[i].active
        );
        if (result !== previous) {
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
        assert.equal(
          result.html,
          stable + result.pending,
          `${id}: html is stable plus pending at update ${i}`
        );
        digest.add(result.html);
        previous = result;
      }
      const settled = api.createHtmlRenderer(htmlOptions());
      try {
        assert.equal(
          previous.html,
          settled.render(source, false, false).html,
          `${id}: final HTML matches a fresh settled render`
        );
      } finally {
        settled.dispose();
      }
      formatter.dispose();
      return digest.finish();
    };
  } else if (operation === 'session-full' || operation === 'session-suffix') {
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
    } else if (operation === 'string-ansi') {
      const ansiOptions = { width: settings.width };
      produce = () => api.renderToAnsi(source, ansiOptions);
    } else if (operation === 'string-frontmatter') {
      // Consume the parsed metadata too: the YAML pass is part of this operation.
      const frontmatterOptions = { frontmatter: true };
      let meta;
      produce = () => {
        const [parsed, output] = api.renderToHtml(source, frontmatterOptions);
        meta = parsed;
        return output;
      };
      check = () =>
        assert.deepEqual(
          meta,
          { title: 'Retry policy', tags: ['http', 'resilience'], draft: false },
          `${id}: frontmatter metadata`
        );
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
  return {
    descriptor,
    run,
    verify,
    renderer,
    api,
    entry,
    source,
    inputs,
    options,
  };
}
