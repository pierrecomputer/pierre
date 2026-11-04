#!/usr/bin/env node

import type { BitsetMap, EnumMap } from '@pierre/wat-tools';
import {
  checkDataSegments,
  dataSegment,
  expandBitsetGets,
  expandBitsets,
  expandEnumGetsAndStrings,
  expandEnums,
  flattenWat,
  optimizeWasm,
  packLe,
  parseWatString,
  replaceForm,
  resolveConsts,
  wat2wasm,
} from '@pierre/wat-tools';
import * as fs from 'node:fs';
import { gzipSync } from 'node:zlib';

// East Asian Wide and Fullwidth code points (EastAsianWidth.txt, EAW in {W, F}).
const WIDE_RANGES =
  '1100-115F,231A-231B,2329-232A,23E9-23EC,23F0,23F3,25FD-25FE,2614-2615,' +
  '2630-2637,2648-2653,267F,268A-268F,2693,26A1,26AA-26AB,26BD-26BE,26C4-26C5,26CE,26D4,' +
  '26EA,26F2-26F3,26F5,26FA,26FD,2705,270A-270B,2728,274C,274E,2753-2755,2757,2795-2797,' +
  '27B0,27BF,2B1B-2B1C,2B50,2B55,2E80-2E99,2E9B-2EF3,2F00-2FD5,2FF0-303E,3041-3096,' +
  '3099-30FF,3105-312F,3131-318E,3190-31E5,31EF-321E,3220-3247,3250-A48C,A490-A4C6,' +
  'A960-A97C,AC00-D7A3,F900-FAFF,FE10-FE19,FE30-FE52,FE54-FE66,FE68-FE6B,FF01-FF60,' +
  'FFE0-FFE6,16FE0-16FE4,16FF0-16FF6,17000-18CD5,18CFF-18D1E,18D80-18DF2,1AFF0-1AFF3,' +
  '1AFF5-1AFFB,1AFFD-1AFFE,1B000-1B122,1B132,1B150-1B152,1B155,1B164-1B167,1B170-1B2FB,' +
  '1D300-1D356,1D360-1D376,1F004,1F0CF,1F18E,1F191-1F19A,1F200-1F202,1F210-1F23B,' +
  '1F240-1F248,1F250-1F251,1F260-1F265,1F300-1F320,1F32D-1F335,1F337-1F37C,1F37E-1F393,' +
  '1F3A0-1F3CA,1F3CF-1F3D3,1F3E0-1F3F0,1F3F4,1F3F8-1F43E,1F440,1F442-1F4FC,1F4FF-1F53D,' +
  '1F54B-1F54E,1F550-1F567,1F57A,1F595-1F596,1F5A4,1F5FB-1F64F,1F680-1F6C5,1F6CC,' +
  '1F6D0-1F6D2,1F6D5-1F6D8,1F6DC-1F6DF,1F6EB-1F6EC,1F6F4-1F6FC,1F7E0-1F7EB,1F7F0,' +
  '1F90C-1F93A,1F93C-1F945,1F947-1F9FF,1FA70-1FA7C,1FA80-1FA8A,1FA8E-1FAC6,1FAC8,' +
  '1FACD-1FADC,1FADF-1FAEA,1FAEF-1FAF8,20000-2FFFD,30000-3FFFD';

const start = performance.now();
const source = new URL('../src/md.wat', import.meta.url);
const path = source.pathname;
const enumMap: EnumMap = new Map();
const bitsetMap: BitsetMap = new Map();
let code = expandEnums(
  flattenWat(source, fs.readFileSync(source, 'utf-8')).code,
  enumMap
);
code = resolveConsts(code, path).code;
code = expandBitsets(code, enumMap, bitsetMap, path);
code = expandBitsetGets(code, bitsetMap, path);

/** Expand `(name <base> <end> ...)` forms into data segments that must fit [base, end). */
function table(
  name: string,
  build: (base: number, inner: string) => Uint8Array
): void {
  code = replaceForm(code, name, (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)/);
    if (m == null) throw new Error(`Malformed ${name} in ${path}`);
    const [base, end] = [Number(m[1]), Number(m[2])];
    const bytes = build(base, inner);
    if (base + bytes.length > end) {
      throw new Error(
        `${name} needs ${bytes.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return dataSegment(base, bytes);
  });
}

/** Ranges of code points from `first` that pass `test`, without surrogates. */
function codePointRanges(
  first: number,
  test: (char: string, cp: number) => boolean
) {
  const ranges: [number, number][] = [];
  let open = -1;
  for (let cp = first; cp <= 0x10ffff; cp++) {
    if ((cp < 0xd800 || cp > 0xdfff) && test(String.fromCodePoint(cp), cp)) {
      if (open < 0) open = cp;
    } else if (open >= 0) {
      ranges.push([open, cp - 1]);
      open = -1;
    }
  }
  return ranges;
}

// HTML5 named character references, read by $entityMatch:
//   [base+0]   values pointer u16, name count u16
//   [base+4]   second code points of two-code-point values, u16 each
//   [base+20]  u16 per block of 64 names: where its first name starts
//   names      sorted by byte and front-coded. Each name is a byte below '0'
//              with the length it shares with the previous name (0 at a block
//              start), then its other bytes. A 0 byte and 0x7f end the list.
//   values     three planes of one byte per name: bits 0-7 of the first code
//              point, bits 8-15, then bit 16 in bit 0 and the 1-based index of
//              the second code point in bits 1-4 (0 = none)
table('entity-table', (base) => {
  const entities: Record<string, string> = {};
  for (const line of fs
    .readFileSync(new URL('../src/entities.txt', import.meta.url), 'utf-8')
    .split('\n')) {
    if (line === '' || line.startsWith('# ')) continue;
    const i = line.indexOf(' ');
    if (i < 0) throw new Error(`malformed entity: ${line}`);
    entities[line.slice(0, i)] = line
      .slice(i + 1)
      .replace(/\\(?:u[0-9a-fA-F]{4}|n|t|\\)/g, (m) =>
        m === '\\n'
          ? '\n'
          : m === '\\t'
            ? '\t'
            : m === '\\\\'
              ? '\\'
              : String.fromCharCode(parseInt(m.slice(2), 16))
      );
  }
  const names = Object.keys(entities).sort();
  const n = names.length;
  const second: number[] = [];
  const stream: number[] = [];
  const blocks: number[] = [];
  const blockStart = base + 20 + Math.ceil(n / 64) * 2;
  const values = new Uint8Array(n * 3);
  let prev = '';
  names.forEach((name, i) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(name))
      throw new Error(`entity name exceeds packed format: ${name}`);
    let shared = 0;
    if (i % 64 === 0) blocks.push(blockStart + stream.length);
    else while (name[shared] === prev[shared]) shared++;
    stream.push(shared);
    for (let j = shared; j < name.length; j++) stream.push(name.charCodeAt(j));
    prev = name;
    const cps = [...entities[name]].map((c) => c.codePointAt(0)!);
    if (cps.length === 2 && !second.includes(cps[1])) second.push(cps[1]);
    if (
      cps.length > 2 ||
      cps[0] > 0x1ffff ||
      second.length > 8 ||
      (cps[1] ?? 0) > 0xffff
    )
      throw new Error(`entity ${name} exceeds packed format`);
    values[i] = cps[0] & 0xff;
    values[n + i] = (cps[0] >> 8) & 0xff;
    values[n * 2 + i] =
      (cps[0] >> 16) |
      (cps.length === 2 ? (second.indexOf(cps[1]) + 1) << 1 : 0);
  });
  stream.push(0, 0x7f);
  const valuesPtr = blockStart + stream.length;
  if (valuesPtr > 0xffff) throw new Error(`entity-table pointers exceed u16`);
  const bytes = new Uint8Array(valuesPtr + values.length - base);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, valuesPtr, true);
  dv.setUint16(2, n, true);
  second.forEach((cp, i) => dv.setUint16(4 + i * 2, cp, true));
  blocks.forEach((at, i) => dv.setUint16(20 + i * 2, at, true));
  bytes.set(stream, blockStart - base);
  bytes.set(values, valuesPtr - base);
  return bytes;
});

// Unicode P and S code points from U+0080, which CommonMark calls punctuation,
// read by $isPunctCp: a u32 range count, then sorted lo:21 + span:11 ranges.
table('unicode-punct-table', () => {
  const ranges = codePointRanges(0x80, (char) => /[\p{P}\p{S}]/u.test(char));
  const bytes = new Uint8Array(4 + ranges.length * 4);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, ranges.length, true);
  ranges.forEach(([lo, hi], i) => {
    if (lo > 0x1fffff || hi - lo > 0x7ff) {
      throw new Error(
        `unicode-punct-table range exceeds packed format: ${lo}-${hi}`
      );
    }
    dv.setUint32(4 + i * 4, lo + (hi - lo) * 0x200000, true);
  });
  return bytes;
});

// (word-table <base> <end> "name" ...): a set of lowercase ASCII words, read by
// $wordLookup. One u16 per length through the longest word (relative names
// offset:9 + count:7), then the names, grouped by length and sorted.
table('word-table', (_, inner) => {
  const words: string[] = (inner.match(/"[\w-]+"/g) ?? [])
    .map((w) => JSON.parse(w))
    .sort((a, b) =>
      a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0
    );
  if (words.some((w) => w.length > 31))
    throw new Error(`word-table entry longer than 31 bytes`);
  if (new Set(words).size !== words.length)
    throw new Error(`duplicate word-table entry`);
  const maxLen = Math.max(...words.map((w) => w.length));
  const groups = (maxLen + 1) * 2;
  const bytes = new Uint8Array(
    groups + words.reduce((n, w) => n + w.length, 0)
  );
  const dv = new DataView(bytes.buffer);
  let at = 0;
  for (let len = 0; len <= maxLen; len++) {
    const of = words.filter((w) => w.length === len);
    const names = groups + at;
    if (names > 0x1ff || of.length > 0x7f)
      throw new Error(`word-table group exceeds packed format`);
    dv.setUint16(len * 2, names | (of.length << 9), true);
    for (const w of of) {
      for (let i = 0; i < len; i++) bytes[groups + at + i] = w.charCodeAt(i);
      at += len;
    }
  }
  return bytes;
});

// Full Unicode case folding from U+0041, used to normalize link labels: a u16
// run count and u16 multi count, then 8-byte runs (start:21 + span:11, then
// signed delta:24 + stride:8). Multi-code-point folds point into a UTF-8 blob.
table('unicode-fold-table', (base) => {
  const runs: { lo: number; hi: number; delta: number; stride: number }[] = [];
  const multi: [number, string][] = [];
  for (let cp = 0x41; cp <= 0x2ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const char = String.fromCodePoint(cp);
    // This round trip gives the full fold: U+1E9E becomes "ss", U+03C2 becomes U+03C3.
    const fold = char.toLowerCase().toUpperCase().toLowerCase();
    if (fold === char) continue;
    const points = [...fold];
    if (points.length > 1) {
      multi.push([cp, fold]);
      continue;
    }
    const delta = points[0].codePointAt(0)! - cp;
    const last = runs[runs.length - 1];
    if (last != null && last.delta === delta && cp - last.hi === last.stride)
      last.hi = cp;
    else if (
      last != null &&
      last.delta === delta &&
      last.lo === last.hi &&
      cp - last.hi <= 2
    ) {
      last.stride = cp - last.hi;
      last.hi = cp;
    } else runs.push({ lo: cp, hi: cp, delta, stride: 1 });
  }
  if (
    runs.some(
      (r) =>
        r.lo > 0x1fffff ||
        r.hi - r.lo > 0x7ff ||
        r.delta < -0x800000 ||
        r.delta > 0x7fffff ||
        (r.stride !== 1 && r.stride !== 2)
    )
  ) {
    throw new Error(`unicode-fold-table run exceeds packed format`);
  }
  const blob = multi.map(([, f]) => Buffer.from(f, 'utf-8'));
  const blobLen = blob.reduce((n, b) => n + b.length, 0);
  const header = 4;
  const bytes = new Uint8Array(
    header + runs.length * 8 + multi.length * 8 + blobLen
  );
  const dv = new DataView(bytes.buffer);
  const blobPtr = base + header + runs.length * 8 + multi.length * 8;
  dv.setUint16(0, runs.length, true);
  dv.setUint16(2, multi.length, true);
  runs.forEach((r, i) => {
    dv.setUint32(header + i * 8, r.lo + (r.hi - r.lo) * 0x200000, true);
    dv.setUint32(
      header + i * 8 + 4,
      (r.stride << 24) | (r.delta & 0xffffff),
      true
    );
  });
  let at = 0;
  multi.forEach(([cp], i) => {
    const off = header + runs.length * 8 + i * 8;
    dv.setUint32(off, cp, true);
    dv.setUint16(off + 4, blobPtr + at, true);
    bytes[off + 6] = blob[i].length;
    bytes.set(blob[i], header + runs.length * 8 + multi.length * 8 + at);
    at += blob[i].length;
  });
  return bytes;
});

// Terminal display widths, read by $displayWidth: code points that take no cell
// (combining marks, format characters, conjoining jamo) as lo:21 + span:11, and
// wide ones as [lo:u32, span:u16].
table('unicode-width-table', (base) => {
  const zero = codePointRanges(
    0,
    (char, cp) =>
      cp !== 0xad &&
      (/[\p{Mn}\p{Me}\p{Cf}]/u.test(char) || (cp >= 0x1160 && cp <= 0x11ff))
  );
  const wide = WIDE_RANGES.split(',').map((r) => {
    const [lo, hi] = r.split('-');
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)];
  });
  const bytes = new Uint8Array(16 + zero.length * 4 + wide.length * 6);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, zero.length, true);
  dv.setUint32(4, wide.length, true);
  dv.setUint32(8, base + 16, true);
  dv.setUint32(12, base + 16 + zero.length * 4, true);
  zero.forEach(([lo, hi], i) => {
    if (lo > 0x1fffff || hi - lo > 0x7ff) {
      throw new Error(
        `unicode-width-table zero-width range is too wide: ${lo}-${hi}`
      );
    }
    dv.setUint32(16 + i * 4, lo + (hi - lo) * 0x200000, true);
  });
  wide.forEach(([lo, hi], i) => {
    if (hi - lo > 0xffff)
      throw new Error(`unicode-width-table range is too wide: ${lo}-${hi}`);
    const off = 16 + zero.length * 4 + i * 6;
    dv.setUint32(off, lo, true);
    dv.setUint16(off + 4, hi - lo, true);
  });
  return bytes;
});

// (out.str "...") writes a literal to the output. Short literals become one
// immediate store. Longer ones go in the string pool.
const pool: string[] = [];
code = replaceForm(code, 'out.str', (inner) => {
  const text = parseWatString(inner.trim(), path);
  if (text.length <= 8)
    return `(call $outSmall (i64.const ${packLe(text)}) (i32.const ${text.length}))`;
  if (text.length <= 16)
    return `(call $outWide (v128.const i64x2 ${packLe(text.slice(0, 8))} ${packLe(text.slice(8))}) (i32.const ${text.length}))`;
  pool.push(text);
  return `(call $outRaw (i32.const  POOL:${pool.length - 1} ) (i32.const ${text.length}))`;
});

// Drop strings that another string contains, then overlap the rest greedily by
// their longest common suffix and prefix.
let poolBlob = '';
let poolBase = 0;
table('string-pool', (base) => {
  const unique = [...new Set(pool)];
  const rest = unique
    .filter(
      (s, i) =>
        !unique.some(
          (o, j) => i !== j && o.includes(s) && (o.length > s.length || j < i)
        )
    )
    .sort((a, b) => b.length - a.length);
  while (rest.length !== 0) {
    let best = 0;
    let overlap = -1;
    for (let i = 0; i < rest.length; i++) {
      if (poolBlob.includes(rest[i])) {
        best = i;
        overlap = rest[i].length;
        break;
      }
      for (
        let n = Math.min(poolBlob.length, rest[i].length - 1);
        n > overlap;
        n--
      ) {
        if (poolBlob.endsWith(rest[i].slice(0, n))) {
          best = i;
          overlap = n;
          break;
        }
      }
    }
    const pick = rest.splice(best, 1)[0];
    if (!poolBlob.includes(pick)) poolBlob += pick.slice(Math.max(overlap, 0));
  }
  poolBase = base;
  return Buffer.from(poolBlob, 'latin1');
});
code = code.replace(/ POOL:(\d+) /g, (_, i) => {
  const at = poolBlob.indexOf(pool[Number(i)]);
  if (at < 0)
    throw new Error(`string pool lost ${JSON.stringify(pool[Number(i)])}`);
  return String(poolBase + at);
});

code = expandEnumGetsAndStrings(code, enumMap, path);
checkDataSegments(code, path, 65536);
const wasmBytes = optimizeWasm(wat2wasm(path, code), {
  filename: 'md.wat',
  shrinkLevel: 1,
});

// tsdown runs next with `clean: false`, so remove old chunks here.
const dist = new URL('../dist/', import.meta.url);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(new URL('md.wasm', dist), wasmBytes);
fs.writeFileSync(
  new URL('md.wasm.mjs', dist),
  `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
    `const b = new Uint8Array(s.length);\n` +
    `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
    `export default b;\n`
);
console.log(
  `Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${wasmBytes.length} bytes, gzipped: ${gzipSync(wasmBytes, { level: 9 }).length} bytes)`
);
