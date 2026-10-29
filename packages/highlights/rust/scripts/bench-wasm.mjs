// Measure the published Highlights wasm in the current JS engine (V8 under
// node, JavaScriptCore under bun) on the Rust benchmark's inputs, with the
// JS package's token protocol: input bytes copied into wasm memory, then
// mode 3, the `(endUtf16, tokenId)` line records `codeToTokens` reads.
// Prints JSON:
// { "<file>": { "mibs": <MiB/s>, "hash": <FNV-1a of the records> }, ... }.
import { readFileSync } from 'node:fs';

const [genDir, budgetMs = '300'] = process.argv.slice(2);
const wasm = readFileSync(`${genDir}/highlights.opt.wasm`);
const langs = JSON.parse(readFileSync(`${genDir}/languages.json`, 'utf8'));
const manifest = JSON.parse(
  readFileSync(`${genDir}/bench/manifest.json`, 'utf8')
);

const idStart = /^\p{ID_Start}$/u;
const idContinue = /^[\u200C\u200D\p{ID_Continue}]$/u;
const dec = new TextDecoder();
// Imports read memory through this holder, which is set after instantiation.
const host = { memory: undefined };
const idClass = (re) => (ptr, len) =>
  Number(re.test(dec.decode(new Uint8Array(host.memory.buffer, ptr, len))));
const { instance } = await WebAssembly.instantiate(wasm, {
  env: { is_id_start: idClass(idStart), is_id_continue: idClass(idContinue) },
});
const mem = instance.exports.memory;
host.memory = mem;
const highlight = instance.exports.highlight;

/** 32-bit FNV-1a, matching the Rust benchmark's parity hash. */
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h = Math.imul(h ^ bytes[i], 0x01000193);
  }
  return h >>> 0;
}

const results = {};
for (const { file, lang } of manifest) {
  const input = readFileSync(`${genDir}/bench/${file}`);
  const need = 65536 + input.length + 96;
  if (mem.buffer.byteLength < need) {
    mem.grow(Math.ceil((need - mem.buffer.byteLength) / 65536));
  }
  const run = () => {
    const u8 = new Uint8Array(mem.buffer);
    u8.set(input, 65536);
    u8[0] = langs[lang];
    u8[1] = 3;
    new DataView(mem.buffer).setUint32(2, input.length, true);
    u8[65536 + input.length] = 0;
    highlight();
  };
  run();
  const view = new DataView(mem.buffer);
  const out = new Uint8Array(
    mem.buffer,
    view.getUint32(6, true),
    view.getUint32(10, true)
  );
  const hash = fnv1a(out);
  // Warm up, then time batches until the budget runs out; keep the best batch.
  for (let i = 0; i < 10; i++) run();
  const batch = Math.max(1, Math.round(2e6 / input.length));
  let best = Infinity;
  const deadline = performance.now() + Number(budgetMs);
  while (performance.now() < deadline) {
    const t = performance.now();
    for (let i = 0; i < batch; i++) run();
    best = Math.min(best, (performance.now() - t) / batch);
  }
  results[file] = { mibs: input.length / 1048576 / (best / 1000), hash };
}
console.log(JSON.stringify(results));
