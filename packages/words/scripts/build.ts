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
const source = new URL('../src/words.wat', import.meta.url);
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

// HTML5 named references: `(entity-table <start> <end> <slots> <names>)`.
// [start, slots) holds one u16 displacement seed per hash bucket, and the
// packed table below starts at `slots`. $unpackEntities expands it at
// instantiation into u32 name/value records in [slots, names) and the names
// after them; pairs keep their address.
//   [slots+0]  u16 offset of the values from `slots`, name count u16
//   names      sorted by byte and front-coded. Each name is a byte below '0'
//              with the length it shares with the previous name, then its
//              other bytes. A 0 byte ends the list.
//   values     two planes of one byte per name: the low and high byte of a
//              u16. It is a code point, or a surrogate as an escape: 0xD800
//              plus the offset of a letter from U+1D400, or 0xDC00 plus the
//              1-based index of a pair.
//   pairs      two u16 code points each. Pair i ends 4 * (i - 1) bytes before
//              `end`, so its address needs no pointer.
table('entity-table', (tableBase, inner) => {
  const [end, base, namesBase] = inner
    .match(/^\s*\d+\s+(\d+)\s+(\d+)\s+(\d+)/)!
    .slice(1)
    .map(Number);
  const seedCount = (base - tableBase) / 2;
  const slotCount = (namesBase - base) / 4;
  // $entitySlot has these sizes as masks and shifts.
  if (seedCount !== 512 || slotCount !== 4096)
    throw new Error('entity-table sizes differ from $entitySlot');
  const entities: Record<string, string> = {};
  for (const line of fs
    .readFileSync(new URL('../tables/entities.txt', import.meta.url), 'utf-8')
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
  const pairs: string[] = [];
  const stream: number[] = [];
  const values = new Uint8Array(n * 2);
  let prev = '';
  names.forEach((name, i) => {
    if (!/^[a-zA-Z][a-zA-Z0-9]{0,30}$/.test(name))
      throw new Error(`entity name exceeds packed format: ${name}`);
    let shared = 0;
    while (name[shared] === prev[shared]) shared++;
    stream.push(shared);
    for (let j = shared; j < name.length; j++) stream.push(name.charCodeAt(j));
    prev = name;
    const cps = Array.from(entities[name], (c) => c.codePointAt(0)!);
    let value = cps[0];
    if (cps.length === 2) {
      if (!pairs.includes(entities[name])) pairs.push(entities[name]);
      value = 0xdc00 + pairs.indexOf(entities[name]) + 1;
    } else if (value > 0xffff) value += 0xd800 - 0x1d400;
    if (
      cps.length > 2 ||
      cps.some((cp) => cp >= 0xd800 && cp <= 0xdfff) ||
      (cps.length === 2 ? cps[0] > 0xffff || cps[1] > 0xffff : false) ||
      (cps[0] > 0xffff && (value < 0xd800 || value > 0xdbff)) ||
      pairs.length > 0x3ff
    )
      throw new Error(`entity ${name} exceeds packed format`);
    values[i] = value & 0xff;
    values[n + i] = value >> 8;
  });
  stream.push(0);
  const valuesAt = 4 + stream.length;
  if (base + valuesAt + values.length > end - pairs.length * 4)
    throw new Error(`entity-table needs more than [${base}:${end})`);
  const bytes = new Uint8Array(end - base);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, valuesAt, true);
  dv.setUint16(2, n, true);
  bytes.set(stream, 4);
  bytes.set(values, valuesAt);
  pairs.forEach((pair, i) => {
    dv.setUint16(bytes.length - (i + 1) * 4, pair.charCodeAt(0), true);
    dv.setUint16(bytes.length - (i + 1) * 4 + 2, pair.charCodeAt(1), true);
  });
  const hashes = names.map((name) => {
    const word = (at: number): number =>
      name.charCodeAt(at) |
      (name.charCodeAt(at + 1) << 8) |
      (name.charCodeAt(at + 2) << 16) |
      (name.charCodeAt(at + 3) << 24);
    let hash = Math.imul(word(0) ^ name.length, 0x9e3779b1);
    hash = Math.imul(
      hash ^ (name.length > 4 ? word(name.length - 4) : 0),
      0x85ebca6b
    );
    if (name.length > 8)
      hash = Math.imul(
        hash ^ word((name.length >>> 1) - 2) ^ (name.charCodeAt(4) << 24),
        0xc2b2ae35
      );
    return (hash ^ (hash >>> 16)) >>> 0;
  });
  if (new Set(hashes).size !== names.length)
    throw new Error('entity-table name hash collision');
  const buckets = Array.from({ length: seedCount }, () => [] as number[]);
  hashes.forEach((hash, at) => buckets[hash & (seedCount - 1)].push(at));
  const slots = Array<number>(slotCount).fill(-1);
  const seeds = new Uint16Array(seedCount);
  const order = buckets
    .map((_, at) => at)
    .sort((a, b) => buckets[b].length - buckets[a].length);
  for (const bucket of order) {
    const entries = buckets[bucket];
    if (entries.length < 2) continue;
    let seed = 0;
    for (; seed < 32768; seed++) {
      const targets = entries.map((at) => {
        const hash = hashes[at];
        return (
          (((hash >>> 9) + Math.imul(seed, (hash >>> 16) | 1)) >>> 0) %
          slots.length
        );
      });
      if (
        new Set(targets).size !== targets.length ||
        targets.some((at) => slots[at] >= 0)
      )
        continue;
      targets.forEach((target, at) => {
        slots[target] = entries[at];
      });
      seeds[bucket] = seed;
      break;
    }
    if (seed === 32768) throw new Error('entity-table displacement exhausted');
  }
  let free = 0;
  for (let bucket = 0; bucket < buckets.length; bucket++) {
    if (buckets[bucket].length !== 1) continue;
    while (slots[free] >= 0) free++;
    slots[free] = buckets[bucket][0];
    seeds[bucket] = 32768 | free;
  }
  const expanded =
    namesBase -
    tableBase +
    names.reduce((size, name) => size + name.length + 1, 0) +
    pairs.length * 4;
  if (expanded + 16 > end - tableBase)
    throw new Error('expanded entity table exceeds static memory');
  if (tableBase + expanded - pairs.length * 4 > 0x10000)
    throw new Error('expanded entity name pointers exceed u16');
  const output = new Uint8Array(end - tableBase);
  const outputView = new DataView(output.buffer);
  seeds.forEach((seed, at) => outputView.setUint16(at * 2, seed, true));
  output.set(bytes, base - tableBase);
  return output;
});

// (word-table <base> <end> "name" ...): a set of lowercase ASCII words, read by
// $wordLookup. One u16 per length through the longest word (relative names
// offset:9 + count:7), then the names, grouped by length and sorted.
table('word-table', (_, inner) => {
  const words: string[] = (inner.match(/"[\w-]+"/g) ?? [])
    .map((w) => w.slice(1, -1))
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

// Unicode caseless keys from U+0041, used to normalize link labels:
//   [base+0]  u16 run count, u16 multi count, u16 pairs pointer, u16 blob pointer
//   runs      u32 each: start:17, span:8, pair index:7. A run folds each of
//             its code points, or every second one, by the same delta.
//   multis    u32 each: code point:17, blob offset:9, UTF-8 length:3
//   pairs     u32 each: signed delta:24, stride:8
//   blob      the UTF-8 text of the folds that take several code points
table('unicode-fold-table', (base) => {
  const runs: { lo: number; hi: number; delta: number; stride: number }[] = [];
  const multi: [number, string][] = [];
  for (let cp = 0x41; cp <= 0x2ffff; cp++) {
    // Warning: uppercasing dotless i would merge it with the distinct i/I label.
    if (cp === 0x131 || (cp >= 0xd800 && cp <= 0xdfff)) continue;
    const char = String.fromCodePoint(cp);
    // This round trip gives a caseless key: U+1E9E becomes "ss", U+03C2 becomes U+03C3.
    const fold = char.toLowerCase().toUpperCase().toLowerCase();
    if (fold === char) continue;
    const points = Array.from(fold);
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
  const pairs: number[] = [];
  const words = runs.map((r) => {
    const pair = (r.stride << 24) | (r.delta & 0xffffff);
    if (!pairs.includes(pair)) pairs.push(pair);
    if (
      r.lo > 0x1ffff ||
      r.hi - r.lo > 0xff ||
      r.delta < -0x800000 ||
      r.delta > 0x7fffff ||
      (r.stride !== 1 && r.stride !== 2) ||
      pairs.length > 0x80
    )
      throw new Error(`unicode-fold-table run exceeds packed format`);
    return r.lo + (r.hi - r.lo) * 0x20000 + pairs.indexOf(pair) * 0x2000000;
  });
  const blob = multi.map(([, f]) => Buffer.from(f, 'utf-8'));
  let at = 0;
  for (const [i, [cp]] of multi.entries()) {
    if (cp > 0x1ffff || at > 0x1ff || blob[i].length > 7)
      throw new Error(`unicode-fold-table fold exceeds packed format`);
    words.push(cp + at * 0x20000 + blob[i].length * 0x4000000);
    at += blob[i].length;
  }
  const header = 8;
  const pairsAt = header + words.length * 4;
  const blobAt = pairsAt + pairs.length * 4;
  if (base + blobAt > 0xffff)
    throw new Error(`unicode-fold-table pointers exceed u16`);
  const bytes = new Uint8Array(blobAt + at);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, runs.length, true);
  dv.setUint16(2, multi.length, true);
  dv.setUint16(4, base + pairsAt, true);
  dv.setUint16(6, base + blobAt, true);
  [...words, ...pairs].forEach((word, i) =>
    dv.setUint32(header + i * 4, word, true)
  );
  bytes.set(Buffer.concat(blob), blobAt);
  return bytes;
});

// (unicode-range-tables <base> <end> <table> <tableEnd> ...): four sets of
// code points, read by $isPunctCp, $cpWidth and $isCjkCp. The P and S general categories
// from U+0080, the code points that take no terminal cell (combining marks,
// format characters, conjoining jamo), and the wide ones. The binary stores
// them packed: per range, a varint with the distance from the end of the
// range before it to its start, then a varint with its length. A 0 byte ends
// a set. $unpackRanges expands each set into its table at instantiation.
table('unicode-range-tables', (_, inner) => {
  const room = inner.trim().split(/\s+/).slice(2).map(Number);
  const wide = WIDE_RANGES.split(',').map((r): [number, number] => {
    const [lo, hi] = r.split('-');
    return [parseInt(lo, 16), parseInt(hi ?? lo, 16)];
  });
  const sets = [
    codePointRanges(0x80, (char) => /[\p{P}\p{S}]/u.test(char)),
    codePointRanges(
      0,
      (char, cp) =>
        cp !== 0xad &&
        (/[\p{Mn}\p{Me}\p{Cf}]/u.test(char) || (cp >= 0x1160 && cp <= 0x11ff))
    ),
    wide,
    // CJK for the cjk option, as markdown-it-cjk-friendly defines it: East
    // Asian Wide, Fullwidth, or Halfwidth without emoji, and Hangul.
    codePointRanges(
      0x1100,
      (char, cp) =>
        /\p{sc=Hangul}/u.test(char) ||
        (!/\p{Emoji_Presentation}/u.test(char) &&
          (cp === 0x20a9 ||
            (cp >= 0xff61 && cp <= 0xffdc) ||
            (cp >= 0xffe8 && cp <= 0xffee) ||
            wide.some(([lo, hi]) => cp >= lo && cp <= hi)))
    ),
  ];
  const bytes: number[] = [];
  sets.forEach((ranges, i) => {
    let at = 0;
    let entries = 0;
    for (const [lo, hi] of ranges) {
      // A table entry holds a span of 11 bits, so a longer range takes several.
      entries += Math.ceil((hi - lo + 1) / 0x800);
      if (lo <= at || lo > 0x1fffff)
        throw new Error(
          `unicode-range-tables range exceeds packed format: ${lo}-${hi}`
        );
      for (let v of [lo - at, hi + 1 - lo]) {
        for (; v > 0x7f; v >>>= 7) bytes.push((v & 0x7f) | 0x80);
        bytes.push(v);
      }
      at = hi + 1;
    }
    bytes.push(0);
    if (4 + entries * 4 > room[i * 2 + 1] - room[i * 2])
      throw new Error(`unicode-range-tables set ${i} needs ${entries} entries`);
  });
  return Uint8Array.from(bytes);
});

// (math-glyphs <base> <end> <stride>): glyph metrics of STIX Two Math for
// src/math.wat, from tables/math-metrics.txt. Five columns of one byte per
// glyph, each <stride> bytes apart: depth (i8), height, italic correction,
// width (u8), and the top accent position less half the width (i8), all in
// hundredths of an em. Columns gzip better than rows. Then a u32 run count
// and per run of consecutive code points a u32 (first | count - 1 << 21) and
// a u16 index of its first glyph.
table('math-glyphs', (_, inner) => {
  const stride = Number(inner.match(/^\s*\d+\s+\d+\s+(\d+)/)![1]);
  const rows = fs
    .readFileSync(
      new URL('../tables/math-metrics.txt', import.meta.url),
      'utf-8'
    )
    .trim()
    .split('\n')
    .map((line) => line.split(' ').map(Number));
  if (rows.length > stride)
    throw new Error(
      `math-glyphs: ${rows.length} glyphs exceed stride ${stride}`
    );
  const runs: number[][] = [];
  for (const [i, [cp]] of rows.entries()) {
    const last = runs.at(-1);
    if (last !== undefined && last[0] + last[1] === cp && last[1] < 2048)
      last[1]++;
    else runs.push([cp, 1, i]);
  }
  const at = stride * 5;
  const bytes = new Uint8Array(at + 4 + runs.length * 6);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(at, runs.length, true);
  runs.forEach(([cp, n, i], r) => {
    dv.setUint32(at + 4 + r * 6, cp | ((n - 1) << 21), true);
    dv.setUint16(at + 8 + r * 6, i, true);
  });
  rows.forEach(([, ...m], i) =>
    m.forEach((v, j) => {
      const q = Math.round((j === 1 ? Math.max(v, 0) : v) / 10);
      const signed = j === 0 || j === 4;
      if (q < (signed ? -128 : 0) || q > (signed ? 127 : 255))
        throw new Error(`math-glyphs metric out of range: ${rows[i][0]} ${v}`);
      dv.setUint8(j * stride + i, q & 0xff);
    })
  );
  return bytes;
});

// (math-commands <base> <end> <packed> <packedEnd> <spill> <spillEnd>): the TeX
// commands of tables/math.txt. At <base>, a u32 per name length up to 31:
// group offset from <base> (u16) and count (u16). The first $mathSvg fills
// the groups: each entry is the name, then a u32 value of
// kind << 24, atom class << 21, and a 16-bit value. Groups that do not fit
// before <end> go to <spill>, and so do the macro bodies, each a length byte
// and its UTF-8 TeX; a macro's value is the offset of its body from <base>,
// and its class is 1 when the body takes an argument. At <packed>, which the
// math nodes reuse later: a u16 name count, three planes of one value byte
// per name (value, then class | kind << 3 in the third), then the names
// sorted and front-coded: a byte below 0x20 with the length shared with the
// previous name, then the rest.
const mathKinds =
  'sym ital op opl fn fnl accent wide frac sqrt left big font text space style color begin end over xarrow phantom boxed not opname limits mod kern cr ignore mathop macro'.split(
    ' '
  );
code = replaceForm(code, 'math-commands', (inner) => {
  const [base, end, packed, packedEnd, spill, spillEnd] = inner
    .trim()
    .split(/\s+/)
    .map(Number);
  const entries = new Map<string, number>();
  const macros = new Map<string, number>();
  const spillBytes: number[] = [];
  // Reserve [at, at + size) in the spill area; its offset from <base>.
  const toSpill = (bytes: number[]) => {
    const at = spill + spillBytes.length - base;
    spillBytes.push(...bytes);
    if (spill + spillBytes.length > spillEnd || at > 0xffff)
      throw new Error(`math-commands spill needs ${spillBytes.length} bytes`);
    return at;
  };
  for (const line of fs
    .readFileSync(new URL('../tables/math.txt', import.meta.url), 'utf-8')
    .split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [kind, cls, ...items] = line.trim().split(/\s+/);
    const k = mathKinds.indexOf(kind);
    let c = 'oObr()pi'.indexOf(cls);
    if (k < 0 || c < 0) throw new Error(`math.txt: bad line ${line}`);
    for (const item of items) {
      const at = kind === 'macro' ? item.indexOf('=') : item.lastIndexOf(':');
      const name = at > 0 ? item.slice(0, at) : item;
      let value = at > 0 ? parseInt(item.slice(at + 1), 16) : 0;
      if (kind === 'macro') {
        const body = item.slice(at + 1);
        const bytes = [...Buffer.from(body, 'utf-8')];
        if (at <= 0 || bytes.length > 255)
          throw new Error(`math.txt: bad macro ${item}`);
        value = macros.get(body) ?? toSpill([bytes.length, ...bytes]);
        macros.set(body, value);
        c = body.includes('#') ? 1 : 0;
      }
      // sym, ital, op and opl print their value as a glyph, so it cannot be 0.
      if (
        entries.has(name) ||
        name.length > 31 ||
        !(value < 1 << 16) ||
        (k < 4 && value === 0) ||
        [...name].some(
          (ch) => ch.charCodeAt(0) <= 0x20 || ch.charCodeAt(0) > 0x7e
        )
      )
        throw new Error(`math.txt: bad entry ${item}`);
      entries.set(name, (k << 19) | (c << 16) | value);
    }
  }
  const header = 32 * 4;
  const names = [...entries.keys()].sort();
  const head = new Uint8Array(header);
  const hv = new DataView(head.buffer);
  let size = header;
  for (let len = 1; len < 32; len++) {
    const n = names.filter((name) => name.length === len).length;
    let at = size;
    if (base + size + n * (len + 4) > end)
      at = toSpill(new Array(n * (len + 4)).fill(0));
    else size += n * (len + 4);
    hv.setUint16(len * 4, at, true);
    hv.setUint16(len * 4 + 2, n, true);
  }
  const bytes = [names.length & 0xff, names.length >> 8];
  for (let plane = 0; plane < 3; plane++)
    for (const name of names)
      bytes.push((entries.get(name)! >> (plane * 8)) & 0xff);
  let prev = '';
  for (const name of names) {
    let shared = 0;
    while (shared < prev.length && prev[shared] === name[shared]) shared++;
    bytes.push(shared);
    for (const ch of name.slice(shared)) bytes.push(ch.charCodeAt(0));
    prev = name;
  }
  bytes.push(0);
  if (packed + bytes.length > packedEnd)
    throw new Error(`math-commands packed needs ${bytes.length} bytes`);
  // the spilled groups are zeros until $mathSvg fills them
  let used = spillBytes.length;
  while (used > 0 && spillBytes[used - 1] === 0) used--;
  return (
    dataSegment(base, head) +
    '\n' +
    dataSegment(packed, bytes) +
    '\n' +
    dataSegment(spill, spillBytes.slice(0, used))
  );
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
checkDataSegments(code, path, 262144);
const wasmBytes = optimizeWasm(wat2wasm(path, code), {
  filename: 'words.wat',
  shrinkLevel: 1,
});

// tsdown runs next with `clean: false`, so remove old chunks here.
const dist = new URL('../dist/', import.meta.url);
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(new URL('words.wasm', dist), wasmBytes);
fs.writeFileSync(
  new URL('words.wasm.mjs', dist),
  `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
    `const b = new Uint8Array(s.length);\n` +
    `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
    `export default b;\n`
);
console.log(
  `Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${wasmBytes.length} bytes, gzipped: ${gzipSync(wasmBytes, { level: 9 }).length} bytes)`
);
