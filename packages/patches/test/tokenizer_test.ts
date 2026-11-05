import { beforeAll, expect, test } from 'bun:test';

import { transformWat, wat2wasm } from '../scripts/build';

let wasm: Record<'t_chars' | 't_words' | 't_lines', (len: number) => number> & {
  memory: WebAssembly.Memory;
};
let memoryBuffer: Uint8Array;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true });

// input at 65536, token offsets at 131072, char ids at 196608
const testWat = `(module
  (import "../src/tokenize.wat")
  (func (export "t_chars") (param $len i32) (result i32)
    (call $tokenizeChars (i32.const 65536) (i32.add (i32.const 65536) (local.get $len))
      (i32.const 131072) (i32.const 196608)))
  (func (export "t_words") (param $len i32) (result i32)
    (call $tokenizeWords (i32.const 65536) (i32.add (i32.const 65536) (local.get $len))
      (i32.const 131072)))
  (func (export "t_lines") (param $len i32) (result i32)
    (call $tokenizeLines (i32.const 65536) (i32.add (i32.const 65536) (local.get $len))
      (i32.const 131072)))
)
`;

beforeAll(() => {
  const watUrl = new URL('./test_tokenizer.wat', import.meta.url);
  const code = transformWat(watUrl, testWat);
  const wasmModule = new WebAssembly.Module(wat2wasm(watUrl.href, code));
  wasm = new WebAssembly.Instance(wasmModule, {}).exports as typeof wasm;
  // mem.wat declares 2 pages; the harness needs 4
  wasm.memory.grow(2);
  memoryBuffer = new Uint8Array(wasm.memory.buffer);
});

/** run a wasm tokenizer and rebuild the token strings from the offsets */
function tokenize(
  kind: 't_chars' | 't_words' | 't_lines',
  src: string
): string[] {
  const bytes = enc.encode(src);
  memoryBuffer.set(bytes, 65536);
  const count = wasm[kind](bytes.length);
  const dv = new DataView(wasm.memory.buffer);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const start = dv.getUint32(131072 + i * 4, true);
    const end = dv.getUint32(131072 + (i + 1) * 4, true);
    out.push(dec.decode(memoryBuffer.subarray(65536 + start, 65536 + end)));
  }
  return out;
}

// reference tokenizers, mirroring jsdiff@9
const extendedWordChars =
  'a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}';
const wordsRegex = new RegExp(
  `(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`,
  'ug'
);
const refChars = (s: string) => Array.from(s);
const refWords = (s: string) => s.match(wordsRegex) ?? [];
const refLines = (s: string) => s.match(/[^\n]*\n|[^\n]+/g) ?? [];

const corpus = [
  '',
  'hello world',
  'foo_bar42 baz',
  'a\nb\nc',
  'a\nb\nc\n',
  '\n\n\n',
  'crlf\r\nline\r\n',
  'lone\rcr\r',
  '\r\n\r\r\n\n',
  'tab\tand \u00A0\u1680\u2000\u200A\u202F\u205F\u3000 spaces',
  '\u200B is not a space',
  '\uFEFF\uFEFFbom start',
  'line\u2028sep and\u2029para',
  // word-class boundary characters
  '\u00AD\u00C0\u00D6\u00D7\u00D8\u00F6\u00F7\u00F8\u02C6\u02C7\u02C8\u02D7\u02D8\u02DD\u02DE\u02FF\u0300\u1DFF\u1E00\u1EFF\u1F00',
  'mixed\u00D7math\u00F7ops',
  'diacritics: caf\u00E9 na\u00EFve \u1E00\u1E01\u1EFF',
  'emoji \u{1F44B}\u{1F3FD} and \u{1D49C}math',
  'punct...!?,;:()[]{}<>',
  '-word - word-word_',
  '\r\nstart with crlf',
  'ends with cr\r',
  '\u1E01\u02C7\u02C7 mix\u02DE\u02FFwords',
];

test('tokenizeChars matches Array.from', () => {
  for (const s of corpus) {
    expect(tokenize('t_chars', s), JSON.stringify(s)).toStrictEqual(
      refChars(s)
    );
  }
});

test('tokenizeWords matches the jsdiff wordsWithSpace regex', () => {
  for (const s of corpus) {
    expect(tokenize('t_words', s), JSON.stringify(s)).toStrictEqual(
      refWords(s)
    );
  }
});

test('tokenizeLines matches the jsdiff line tokenizer', () => {
  for (const s of corpus) {
    expect(tokenize('t_lines', s), JSON.stringify(s)).toStrictEqual(
      refLines(s)
    );
  }
});
