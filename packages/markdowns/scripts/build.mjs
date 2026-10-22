#!/usr/bin/env node

import binaryen from 'binaryen';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import wabt from 'wabt';

const { parseWat } = await wabt();

/**
 * transform the given wat file, to support:
 * - import other wat files
 * - define enums (`enum`, `enum.get`)
 * - define named memory addresses (`const`, see src/memory.wat)
 * - define bit-per-predicate lookup tables over an enum (`bitset`, `bitset.get`)
 * - intern output string literals into one pooled data segment (`out.str`, `string-pool`)
 * - emit the HTML5 named character reference tables (`entity-table`)
 * - convert i32/i64.const string operands to integer literals
 * @param {string|URL} url
 * @param {string} [content] wat text; read from `url` when omitted
 * @returns {{code: string, enumMap: Map<string, Record<string, number>>, constMap: Map<string, number>,
 *   bitsetMap: Map<string, {base: number, bits: Record<string, number>}>, poolSize: number}}
 */
export function transformWat(url, content) {
  if (!(url instanceof URL)) url = pathToFileURL(url);
  if (content === undefined) content = fs.readFileSync(url, 'utf-8');
  const enumMap = new Map();
  const bitsetMap = new Map();
  const imports = [];
  const seen = new Set([url.href]);
  const flatten = (moduleUrl, source) =>
    source.replace(/\(\s*import\s+"(\.+\/.+\.wat)"\s*\)/g, (_, path) => {
      const importUrl = new URL(path, moduleUrl);
      if (seen.has(importUrl.href)) return '';
      seen.add(importUrl.href);
      return flatten(importUrl, fs.readFileSync(importUrl, 'utf-8')).replace(
        /^\s*\(\s*module\s+([\s\S]+)\s*\)\s*$/,
        '$1'
      );
    });
  // comment lines are anchored as whole lines ((?:;;[^\n]*\n\s*)*) - an
  // ambiguous (;;.+\s+)* here backtracks exponentially on comment blocks
  // with trailing whitespace
  let code = flatten(url, content)
    .replace(/(?:;;[^\n]*\n\s*)*\(\s*import +".+" +\( *func.+\)/g, (i) => {
      imports.push(i);
      return '';
    })
    .replace(/\s*\(\s*enum\s+(\$\w+)\s+([^)]+)\s*\)/g, (_, key, members) => {
      if (enumMap.has(key)) throw new Error(`Duplicate enum ${key}`);
      let i = 0;
      enumMap.set(
        key,
        Object.fromEntries(
          members
            .split(/\s+/g)
            .map((l) => l.trim())
            .filter((l) => l && /^"[\w.]+"$/.test(l))
            .map((l) => [JSON.parse(l), i++])
        )
      );
      return '';
    });

  // (const $mem.name <int|$other>[+-<int>]) - named memory addresses, declared
  // once in src/memory.wat and substituted everywhere, so a region only ever
  // moves in one place. A reference may carry the same +/- bias (`$mem.x-1`),
  // which is why const names must not contain `-`.
  const constExprs = new Map();
  code = code.replace(
    /\s*\(\s*const\s+(\$[\w.]+)\s+(\$[\w.]+|\d+)([+-]\d+)?\s*\)/g,
    (_, name, value, bias) => {
      if (constExprs.has(name))
        throw new Error(`Duplicate const ${name} in ${url.pathname}`);
      constExprs.set(name, { value, bias: bias ? Number(bias) : 0 });
      return '';
    }
  );
  const constMap = new Map();
  const resolveConst = (name, pending) => {
    if (constMap.has(name)) return constMap.get(name);
    const expr = constExprs.get(name);
    if (!expr)
      throw new Error(`Const '${name}' is undefined in ${url.pathname}`);
    if (pending.has(name))
      throw new Error(`Const '${name}' is cyclic in ${url.pathname}`);
    pending.add(name);
    const base = /^\d+$/.test(expr.value)
      ? Number(expr.value)
      : resolveConst(expr.value, pending);
    constMap.set(name, base + expr.bias);
    return base + expr.bias;
  };
  for (const name of constExprs.keys()) resolveConst(name, new Set());
  code = code.replace(/(\$[\w.]+)([+-]\d+)?/g, (all, name, bias) =>
    constMap.has(name) ? String(constMap.get(name) + Number(bias ?? 0)) : all
  );
  const stray = code.match(/\$mem\.[\w.]+/);
  if (stray)
    throw new Error(`Const '${stray[0]}' is undefined in ${url.pathname}`);

  // (bitset $Name $Enum <base> (pred "member" ...) ...) - one byte per enum
  // member, one bit per predicate, emitted as a data segment at <base>. Turns a
  // long eq-ladder into a load+and whose cost does not grow with the set size.
  code = replaceForm(code, 'bitset', (raw) => {
    const inner = raw.replace(/;;[^\n]*/g, ''); // comments may sit between members
    const head = inner.match(/^\s*(\$\w+)\s+(\$\w+)\s+(\d+)/);
    if (!head) throw new Error(`Malformed bitset in ${url.pathname}`);
    const [, name, enumKey, baseStr] = head;
    if (bitsetMap.has(name)) throw new Error(`Duplicate bitset ${name}`);
    const members = enumMap.get(enumKey);
    if (!members)
      throw new Error(
        `Bitset '${name}' references unknown enum '${enumKey}' in ${url.pathname}`
      );
    const base = Number(baseStr);
    const bytes = new Uint8Array(Object.keys(members).length);
    const bits = {};
    let bit = 0;
    for (const [, pred, list] of inner.matchAll(
      /\((\w+)((?:\s+"[\w.]+")+)\s*\)/g
    )) {
      if (bit > 7)
        throw new Error(
          `Bitset '${name}' has more than 8 predicates in ${url.pathname}`
        );
      bits[pred] = 1 << bit++;
      for (const q of list.match(/"[\w.]+"/g)) {
        const member = JSON.parse(q);
        if (members[member] === undefined) {
          throw new Error(
            `Bitset '${name}.${pred}': '${member}' is not in enum '${enumKey}' in ${url.pathname}`
          );
        }
        bytes[members[member]] |= bits[pred];
      }
    }
    bitsetMap.set(name, { base, bits });
    return `;; ${name}: ${Object.keys(bits).join(', ')}\n  ${dataSegment(base, bytes)}`;
  });

  // (bitset.get $Name.pred <expr>) -> (i32.and (i32.load8_u offset=base <expr>) (i32.const mask))
  code = replaceForm(code, 'bitset.get', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\.(\w+)\s+([\s\S]+)$/);
    if (!m) throw new Error(`Malformed bitset.get in ${url.pathname}`);
    const [, name, pred, expr] = m;
    const table = bitsetMap.get(name);
    const mask = table?.bits[pred];
    if (mask === undefined)
      throw new Error(
        `Bitset '${name}.${pred}' is undefined in ${url.pathname}`
      );
    return `(i32.and (i32.load8_u offset=${table.base} ${expr.trim()}) (i32.const ${mask}))`;
  });

  // (entity-table <base> <end>) - the HTML5 named character references, as a
  // 4-byte pointer header and 32 length groups followed by the names, a packed
  // 2-byte record per name, and the UTF-8 replacement bytes. See $entityLookup.
  code = replaceForm(code, 'entity-table', (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!m) throw new Error(`Malformed entity-table in ${url.pathname}`);
    const [base, end] = [Number(m[1]), Number(m[2])];
    const { bytes, entries } = buildEntityTable(base);
    if (base + bytes.length > end) {
      throw new Error(
        `entity-table needs ${bytes.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return `;; ${entries} HTML5 named character references (${bytes.length} bytes)\n  ${dataSegment(base, bytes)}`;
  });

  // (unicode-punct-table <base> <end>) - the code point ranges >= U+0080 in the
  // Unicode P (punctuation) and S (symbol) general categories, which CommonMark
  // calls "Unicode punctuation characters". Emitted as a u32 range count
  // followed by sorted u32 values with a 21-bit start and 11-bit span; see
  // $isPunctCp in src/scan.wat.
  code = replaceForm(code, 'unicode-punct-table', (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!m) throw new Error(`Malformed unicode-punct-table in ${url.pathname}`);
    const [base, end] = [Number(m[1]), Number(m[2])];
    const ranges = [];
    let start = -1;
    for (let cp = 0x80; cp <= 0x10ffff; cp++) {
      const ok =
        cp >= 0xd800 && cp <= 0xdfff
          ? false
          : /[\p{P}\p{S}]/u.test(String.fromCodePoint(cp));
      if (ok) {
        if (start < 0) start = cp;
      } else if (start >= 0) {
        ranges.push([start, cp - 1]);
        start = -1;
      }
    }
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
    if (base + bytes.length > end) {
      throw new Error(
        `unicode-punct-table needs ${bytes.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return `;; ${ranges.length} Unicode P|S ranges (${bytes.length} bytes)\n  ${dataSegment(base, bytes)}`;
  });

  // (word-table <base> <end> "name" ...) - a set of lowercase ASCII words as one
  // packed u16 group per length through the longest word (relative names
  // offset:9 + count:7), followed by the names grouped by length and sorted.
  // See $wordLookup in src/htmlscan.wat.
  code = replaceForm(code, 'word-table', (raw) => {
    const inner = raw.replace(/;;[^\n]*/g, '');
    const head = inner.match(/^\s*(\d+)\s+(\d+)/);
    if (!head) throw new Error(`Malformed word-table in ${url.pathname}`);
    const [base, end] = [Number(head[1]), Number(head[2])];
    const words = (inner.match(/"[\w-]+"/g) ?? []).map((w) => JSON.parse(w));
    words.sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    if (words.some((w) => w.length > 31))
      throw new Error(`word-table entry longer than 31 bytes`);
    if (new Set(words).size !== words.length)
      throw new Error(`duplicate word-table entry`);
    const maxLen = Math.max(...words.map((w) => w.length));
    const groups = (maxLen + 1) * 2;
    const nameBytes = words.reduce((n, w) => n + w.length, 0);
    const bytes = new Uint8Array(groups + nameBytes);
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
    if (base + bytes.length > end) {
      throw new Error(
        `word-table needs ${bytes.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return `;; ${words.length} words through length ${maxLen} (${bytes.length} bytes)\n  ${dataSegment(base, bytes)}`;
  });

  // (unicode-fold-table <base> <end>) - full Unicode case folding for code
  // points >= U+0041, used to normalize link labels. A packed u16 run count +
  // u16 multi count is followed by 8-byte runs: a 21-bit start + 11-bit span,
  // then signed delta:24 + stride:8. Multi-code-point folds point into a UTF-8 blob.
  code = replaceForm(code, 'unicode-fold-table', (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!m) throw new Error(`Malformed unicode-fold-table in ${url.pathname}`);
    const [base, end] = [Number(m[1]), Number(m[2])];
    // toLowerCase().toUpperCase().toLowerCase() reproduces the full case fold:
    // the round trip is what turns U+1E9E into "ss" and U+03C2 into U+03C3
    const fold = (cp) => {
      const s = String.fromCodePoint(cp);
      return s.toLowerCase().toUpperCase().toLowerCase();
    };
    const runs = [];
    const multi = [];
    for (let cp = 0x41; cp <= 0x2ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const f = fold(cp);
      if (f === String.fromCodePoint(cp)) continue;
      const points = [...f];
      if (points.length > 1) {
        multi.push([cp, f]);
        continue;
      }
      const delta = points[0].codePointAt(0) - cp;
      const last = runs[runs.length - 1];
      if (last && last.delta === delta && cp - last.hi === last.stride)
        last.hi = cp;
      else if (
        last &&
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
    const runsPtr = base + header;
    const multiPtr = runsPtr + runs.length * 8;
    const blobPtr = multiPtr + multi.length * 8;
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
    if (base + bytes.length > end) {
      throw new Error(
        `unicode-fold-table needs ${bytes.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return `;; ${runs.length} fold runs + ${multi.length} multi-character folds (${bytes.length} bytes)\n  ${dataSegment(
      base,
      bytes
    )}`;
  });

  // (unicode-width-table <base> <end>) - the terminal display width tables:
  // the code points that occupy no cell (combining marks, format characters,
  // conjoining jamo) and the East Asian Wide and Fullwidth ones that occupy
  // two. Zero-width ranges use one u32 (lo:21 + span:11); wide ranges use
  // [lo:u32, span:u16]. See $displayWidth in src/ansi.wat.
  code = replaceForm(code, 'unicode-width-table', (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!m) throw new Error(`Malformed unicode-width-table in ${url.pathname}`);
    const [base, end] = [Number(m[1]), Number(m[2])];
    const zero = [];
    let start = -1;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const ok =
        cp >= 0xd800 && cp <= 0xdfff
          ? false
          : cp !== 0xad &&
            (/[\p{Mn}\p{Me}\p{Cf}]/u.test(String.fromCodePoint(cp)) ||
              (cp >= 0x1160 && cp <= 0x11ff));
      if (ok) {
        if (start < 0) start = cp;
      } else if (start >= 0) {
        zero.push([start, cp - 1]);
        start = -1;
      }
    }
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
    if (base + bytes.length > end) {
      throw new Error(
        `unicode-width-table needs ${bytes.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return `;; ${zero.length} zero-width and ${wide.length} wide ranges (${bytes.length} bytes)\n  ${dataSegment(
      base,
      bytes
    )}`;
  });

  // (out.str "...") -> a call writing the literal to the output buffer. Short
  // literals become one immediate store; longer ones are interned into the
  // pooled data segment emitted by (string-pool ...).
  const pool = [];
  code = replaceForm(code, 'out.str', (inner) => {
    const text = parseWatString(inner.trim(), url);
    if (text.length === 0) return '(nop)';
    if (text.length <= 8)
      return `(call $outSmall (i64.const ${packLe(text)}) (i32.const ${text.length}))`;
    pool.push(text);
    return `(call $outRaw (i32.const  POOL:${pool.length - 1} ) (i32.const ${text.length}))`;
  });
  let poolBlob = '';
  let poolBase = 0;
  code = replaceForm(code, 'string-pool', (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (!m) throw new Error(`Malformed string-pool in ${url.pathname}`);
    const [base, end] = [Number(m[1]), Number(m[2])];
    poolBase = base;
    poolBlob = mergeStrings([...new Set(pool)]);
    if (base + poolBlob.length > end) {
      throw new Error(
        `string-pool needs ${poolBlob.length} bytes, [${base}:${end}) has ${end - base}`
      );
    }
    return `;; string pool (${poolBlob.length} bytes)\n  ${dataSegment(base, Buffer.from(poolBlob, 'latin1'))}`;
  });
  const poolSize = poolBlob.length;
  code = code.replace(/ POOL:(\d+) /g, (_, i) => {
    const at = poolBlob.indexOf(pool[Number(i)]);
    if (at < 0)
      throw new Error(`string pool lost ${JSON.stringify(pool[Number(i)])}`);
    return String(poolBase + at);
  });
  if (code.includes(' POOL:'))
    throw new Error('(out.str ...) used without a (string-pool ...) segment');

  code = code
    .replace(
      /(\(\s*)enum\.get\s+(\$\w+)\.([\w.]+)/g,
      (_, prefix, key, memberName) => {
        const i = enumMap.get(key)?.[memberName];
        if (i === undefined)
          throw new Error(
            `Enum '${key}.${memberName}' is undefined in ${url.pathname}`
          );
        return prefix + 'i32.const ' + i;
      }
    )
    .replace(/i(32|64)\.const\s+("(?:[^"\\]|\\.)*")/g, (_, bits, str) => {
      const chars = parseWatString(str, url);
      if (chars.length > Number(bits) / 8) {
        throw new Error(
          `Could not convert '${chars}' to i${bits} in ${url.pathname}`
        );
      }
      return `i${bits}.const ${packLe(chars)}`;
    });
  checkDataSegments(code, url.pathname);
  if (imports.length) {
    code = code.replace(
      /^\s*\(\s*module(\s+)/,
      `(module\n${imports.map((i) => '  ' + i).join('\n')}$1`
    );
  }
  return { code, enumMap, bitsetMap, constMap, poolSize };
}

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

/** little-endian integer literal for up to 8 latin-1 characters */
function packLe(chars) {
  let hex = '';
  for (const c of chars) {
    const b = c.charCodeAt(0);
    if (b > 0xff) throw new Error(`'${chars}' is not a byte string`);
    hex = b.toString(16).padStart(2, '0') + hex;
  }
  return '0x' + (hex || '00');
}

/** decode a wat string literal (\xx, \n, \t, \r, \", \\) into latin-1 characters */
function parseWatString(raw, url) {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) {
    throw new Error(`Expected a string literal, got ${raw} in ${url.pathname}`);
  }
  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    const c = raw[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === 'n') out += '\n';
    else if (n === 't') out += '\t';
    else if (n === 'r') out += '\r';
    else if (n === '"' || n === '\\' || n === "'") out += n;
    else if (/[0-9a-fA-F]/.test(n) && /[0-9a-fA-F]/.test(raw[i + 1])) {
      out += String.fromCharCode(parseInt(n + raw[++i], 16));
    } else throw new Error(`Bad escape in ${raw} (${url.pathname})`);
  }
  return out;
}

/** a data segment, with every byte escaped so the wat text stays 7-bit clean */
function dataSegment(base, bytes) {
  let out = '';
  for (const b of bytes) out += '\\' + b.toString(16).padStart(2, '0');
  return `(data (i32.const ${base}) "${out}")`;
}

/**
 * concatenate the strings, dropping any that is already a substring of another
 * and overlapping the rest greedily by longest common suffix/prefix
 * @param {string[]} strings
 * @returns {string}
 */
function mergeStrings(strings) {
  const rest = strings
    .filter(
      (s, i) =>
        !strings.some(
          (o, j) => i !== j && o.includes(s) && (o.length > s.length || j < i)
        )
    )
    .sort((a, b) => b.length - a.length);
  let blob = '';
  while (rest.length) {
    let best = 0;
    let overlap = -1;
    for (let i = 0; i < rest.length; i++) {
      if (blob.includes(rest[i])) {
        best = i;
        overlap = rest[i].length;
        break;
      }
      for (
        let n = Math.min(blob.length, rest[i].length - 1);
        n > overlap;
        n--
      ) {
        if (blob.endsWith(rest[i].slice(0, n))) {
          best = i;
          overlap = n;
          break;
        }
      }
    }
    const pick = rest.splice(best, 1)[0];
    if (!blob.includes(pick)) blob += pick.slice(Math.max(overlap, 0));
  }
  return blob;
}

/**
 * the HTML5 named character reference tables, laid out as
 *   [base+0]  recordsPtr u16, valuesPtr u16
 *   groups    one 8-byte record per name length 0..31:
 *             namesPtr u16 (first name of that length), firstIndex u16, count u16, pad u16
 *   records   2 bytes per name in (length, lexicographic) order:
 *             valueLength 3 bits, valueOffset 13 bits
 *   values    the UTF-8 replacement bytes
 * @param {number} base
 */
function unescapeEntity(value) {
  return value.replace(/\\(?:u[0-9a-fA-F]{4}|n|t|\\)/g, (m) =>
    m === '\\n'
      ? '\n'
      : m === '\\t'
        ? '\t'
        : m === '\\\\'
          ? '\\'
          : String.fromCharCode(parseInt(m.slice(2), 16))
  );
}

function loadEntities() {
  const table = {};
  for (const line of fs
    .readFileSync(new URL('../src/entities.txt', import.meta.url), 'utf-8')
    .split('\n')) {
    if (!line || line.startsWith('# ')) continue;
    const i = line.indexOf(' ');
    if (i < 0) throw new Error(`malformed entity: ${line}`);
    table[line.slice(0, i)] = unescapeEntity(line.slice(i + 1));
  }
  return table;
}

function buildEntityTable(base) {
  const table = loadEntities();
  const names = Object.keys(table).sort(
    (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
  );
  const maxLen = names[names.length - 1].length;
  if (maxLen > 31)
    throw new Error(
      `entity name longer than 31 bytes: ${names[names.length - 1]}`
    );
  const header = 4;
  const groups = 32 * 8;
  const nameBytes = names.reduce((n, s) => n + s.length, 0);
  const namesPtr = base + header + groups;
  const recordsPtr = namesPtr + nameBytes;
  const values = [];
  const seenValues = new Set();
  for (const name of names) {
    const key = Buffer.from(table[name], 'utf-8').toString('latin1');
    if (!seenValues.has(key)) {
      seenValues.add(key);
      values.push(key);
    }
  }
  const valueBlob = mergeStrings(values);
  const valueOffset = new Map(
    values.map((value) => [value, valueBlob.indexOf(value)])
  );
  const valuesPtr = recordsPtr + names.length * 2;
  const bytes = new Uint8Array(
    header + groups + nameBytes + names.length * 2 + valueBlob.length
  );
  const dv = new DataView(bytes.buffer);
  if (valuesPtr > 0xffff) throw new Error(`entity-table pointers exceed u16`);
  dv.setUint16(0, recordsPtr, true);
  dv.setUint16(2, valuesPtr, true);
  let nameAt = 0;
  let index = 0;
  for (let len = 0; len < 32; len++) {
    const group = header + len * 8;
    const of = names.filter((n) => n.length === len);
    dv.setUint16(group, namesPtr + nameAt, true);
    dv.setUint16(group + 2, index, true);
    dv.setUint16(group + 4, of.length, true);
    for (const name of of) {
      for (let i = 0; i < len; i++)
        bytes[header + groups + nameAt + i] = name.charCodeAt(i);
      nameAt += len;
      const value = Buffer.from(table[name], 'utf-8').toString('latin1');
      const offset = valueOffset.get(value);
      if (offset > 0x1fff || value.length > 7)
        throw new Error('entity replacement exceeds packed format');
      const record = header + groups + nameBytes + index * 2;
      dv.setUint16(record, offset | (value.length << 13), true);
      index++;
    }
  }
  bytes.set(
    Buffer.from(valueBlob, 'latin1'),
    header + groups + nameBytes + names.length * 2
  );
  return { bytes, entries: names.length };
}

/**
 * find every `(head ...)` form and replace it with `fn(innerText)`.
 * scans parens so nested forms and string operands survive.
 * @param {string} code
 * @param {string} head
 * @param {(inner: string) => string} fn
 * @returns {string}
 */
function replaceForm(code, head, fn) {
  const open = new RegExp(
    `\\(\\s*${head.replace(/[.$]/g, '\\$&')}(?=[\\s(])`,
    'g'
  );
  let out = '';
  let last = 0;
  let m;
  while ((m = open.exec(code))) {
    let depth = 0,
      i = m.index,
      inStr = false,
      inComment = false;
    for (; i < code.length; i++) {
      const c = code[i];
      if (inComment) {
        if (c === '\n') inComment = false;
        continue;
      }
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === ';' && code[i + 1] === ';') inComment = true;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) break;
    }
    if (depth !== 0)
      throw new Error(`Unterminated (${head} ...) form at offset ${m.index}`);
    out += code.slice(last, m.index) + fn(code.slice(m.index + m[0].length, i));
    last = i + 1;
    open.lastIndex = last;
  }
  return out + code.slice(last);
}

/**
 * assert the static tables of src/memory.wat still tile page 1: every data
 * segment must stay inside it and no two may overlap. A mistyped address in
 * the layout would otherwise corrupt another table silently.
 * @param {string} code fully expanded wat text
 * @param {string} path source path, for error messages
 */
function checkDataSegments(code, path) {
  const segments = [];
  const open = /\(\s*data\s+\(\s*i32\.const\s+(\d+)\s*\)/g;
  let m;
  while ((m = open.exec(code))) {
    let depth = 1,
      i = m.index + m[0].length,
      inStr = false,
      inComment = false,
      length = 0;
    for (; i < code.length && depth; i++) {
      const c = code[i];
      if (inComment) {
        if (c === '\n') inComment = false;
      } else if (inStr) {
        if (c === '\\') {
          i += /[0-9a-fA-F]{2}/.test(code.slice(i + 1, i + 3)) ? 2 : 1;
          length++;
        } else if (c === '"') inStr = false;
        else length++;
      } else if (c === '"') inStr = true;
      else if (c === ';' && code[i + 1] === ';') inComment = true;
      else if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    segments.push({ base: Number(m[1]), end: Number(m[1]) + length });
    open.lastIndex = i;
  }
  segments.sort((a, b) => a.base - b.base);
  for (const [i, seg] of segments.entries()) {
    if (seg.end > 65536)
      throw new Error(
        `data segment [${seg.base}:${seg.end}) overflows page 1 in ${path}`
      );
    const next = segments[i + 1];
    if (next && next.base < seg.end) {
      throw new Error(
        `data segments [${seg.base}:${seg.end}) and [${next.base}:${next.end}) overlap in ${path}`
      );
    }
  }
}

/**
 * convert the given wat text to wasm binary
 * @param {string} filename
 * @param {string} text
 * @param {Record<string, boolean>} [options]
 * @returns {Uint8Array}
 */
export function wat2wasm(filename, text, options) {
  const wasmModule = parseWat(
    filename,
    text,
    options ?? { bulk_memory: true, simd: true }
  );
  try {
    return wasmModule.toBinary({}).buffer;
  } finally {
    wasmModule.destroy();
  }
}

/**
 * optimize a wasm binary with binaryen (`wasm-opt -O3 --shrink-level=1`) and
 * use Binaryen's optimized Stack IR writer for the final encoding. The pipeline
 * runs three times: re-reading an optimized binary lets the next pass fold
 * patterns the previous one exposed.
 * @param {Uint8Array} wasmBytes
 * @returns {Uint8Array}
 */
export function optimizeWasm(wasmBytes) {
  binaryen.setOptimizeLevel(3);
  binaryen.setShrinkLevel(1);
  binaryen.setGenerateStackIR(true);
  binaryen.setOptimizeStackIR(true);
  for (let pass = 0; pass < 3; pass++) {
    const wasmModule = binaryen.readBinary(wasmBytes);
    try {
      // must match the features `wat2wasm` compiles with, so binaryen never emits an
      // instruction the target runtimes cannot execute
      wasmModule.setFeatures(
        binaryen.Features.BulkMemory |
          binaryen.Features.BulkMemoryOpt |
          binaryen.Features.SIMD128
      );
      if (!wasmModule.validate())
        throw new Error('binaryen rejected the module');
      wasmModule.optimize();
      wasmBytes = wasmModule.emitBinary();
    } finally {
      wasmModule.dispose();
    }
  }
  return wasmBytes;
}

// Build md.wasm when this script is executed directly.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  try {
    const outputUrl = new URL('../dist/', moduleUrl);
    fs.mkdirSync(outputUrl, { recursive: true });
    for (const file of fs.readdirSync(new URL('../lib/', moduleUrl))) {
      if (file.endsWith('.mjs') || file.endsWith('.d.ts')) {
        fs.copyFileSync(
          new URL(`../lib/${file}`, moduleUrl),
          new URL(file, outputUrl)
        );
      }
    }
    const { code } = transformWat(new URL('../src/md.wat', moduleUrl));
    fs.writeFileSync(new URL('../dist/md.wat', moduleUrl), code, 'utf-8');
    const rawBytes = wat2wasm(
      new URL('../dist/md.wasm', moduleUrl).pathname,
      code
    );
    const wasmBytes = optimizeWasm(rawBytes);
    fs.writeFileSync(new URL('../dist/md.wasm', moduleUrl), wasmBytes);
    fs.writeFileSync(
      new URL('../dist/md.wasm.mjs', moduleUrl),
      `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
        `const b = new Uint8Array(s.length);\n` +
        `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
        `export default b;\n`,
      'utf-8'
    );
    const meta = {
      'md.wasm': wasmBytes.length,
      'md.wasm.gz': gzipSync(wasmBytes, { level: 9 }).length,
    };
    fs.writeFileSync(
      new URL('../dist/meta.json', moduleUrl),
      JSON.stringify(meta) + '\n'
    );
    console.log(
      `Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${meta['md.wasm']} bytes, gzipped: ${
        meta['md.wasm.gz']
      } bytes, -O3)`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  }
}
