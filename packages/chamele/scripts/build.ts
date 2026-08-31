import binaryen from 'binaryen';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'url';
import wabt from 'wabt';

const { parseWat } = await wabt();

/** The expanded module text plus the symbol tables the transform resolved. */
export interface TransformedWat {
  code: string;
  enumMap: Map<string, Record<string, number>>;
  bitsetMap: Map<string, { base: number; bits: Record<string, number> }>;
  constMap: Map<string, number>;
}

/**
 * Transform WAT source:
 * - inline local imports
 * - expand enums
 * - resolve named addresses (`const`; see `src/memory.wat`)
 * - emit CSS-variable tables (`css-variable-table`)
 * - emit enum bitsets (`bitset`)
 * - convert string operands for `i32.const` and `i64.const` to integer literals
 *
 * `content` is the wat text; it is read from `url` when omitted.
 */
export function transformWat(
  url: string | URL,
  content?: string
): TransformedWat {
  if (!(url instanceof URL)) url = pathToFileURL(url);
  content ??= readFileSync(url, 'utf-8');
  const enumMap = new Map<string, Record<string, number>>();
  const bitsetMap = new Map<
    string,
    { base: number; bits: Record<string, number> }
  >();
  const imports: string[] = [];
  const seen = new Set([url.href]);
  const flatten = (moduleUrl: URL, source: string): string =>
    source.replace(/\(\s*import\s+"(\.+\/.+\.wat)"\s*\)/g, (_, path) => {
      const importUrl = new URL(path, moduleUrl);
      if (seen.has(importUrl.href)) return '';
      seen.add(importUrl.href);
      return flatten(importUrl, readFileSync(importUrl, 'utf-8')).replace(
        /^\s*\(\s*module\s+([\s\S]+)\s*\)\s*$/,
        '$1'
      );
    });
  // Match comment blocks as whole lines. A broad `(?:;;.+\s+)*` pattern
  // backtracks exponentially on blocks with trailing whitespace.
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
            .map((l: string) => l.trim())
            .filter((l: string) => l !== '' && /^"[\w.]+"$/.test(l))
            .map((l: string): [string, number] => [
              JSON.parse(l) as string,
              i++,
            ])
        )
      );
      return '';
    });

  // Preserve top-level lexer locals between streaming calls. Nested lexers
  // used for embedded ranges see a non-zero depth and stay ordinary bounded
  // calls. TypeScript has its own resumable state machine.
  const streamLexers = new Set([
    '$hlAsm',
    '$hlAstro',
    '$hlBash',
    '$hlC',
    '$hlCpp',
    '$hlCss',
    '$hlDiff',
    '$hlGlsl',
    '$hlGo',
    '$hlHaskell',
    '$hlHtml',
    '$hlJson',
    '$hlKotlin',
    '$hlLua',
    '$hlMarkdown',
    '$hlMdx',
    '$hlPhp',
    '$hlPython',
    '$hlRust',
    '$hlSql',
    '$hlSvelte',
    '$hlSwift',
    '$hlToml',
    '$hlVue',
    '$hlWat',
    '$hlXml',
    '$hlYaml',
    '$hlZig',
  ]);
  let streamStateOffset = 0;
  code = replaceForm(code, 'func', (inner) => {
    const name = inner.match(/^\s*(\$\w+)/)?.[1];
    if (name === undefined || !streamLexers.has(name)) return `(func${inner})`;
    if (inner.includes('(return')) {
      throw new Error(`${name} cannot checkpoint locals with an early return`);
    }
    const locals = [...inner.matchAll(/\(local\s+(\$\w+)\s+(i32|i64)\s*\)/g)];
    const state = locals.map(([, local, type]) => {
      const size = type === 'i64' ? 8 : 4;
      streamStateOffset = (streamStateOffset + size - 1) & -size;
      const at = streamStateOffset;
      streamStateOffset += size;
      return { local, type, at };
    });
    if (streamStateOffset > 4000) {
      throw new Error('stream lexer state exceeds reserved memory');
    }
    const load = state
      .map(
        ({ local, type, at }) =>
          `(local.set ${local} (${type}.load (i32.const $mem.streamState+${at})))`
      )
      .join('\n          ');
    const save = state
      .map(
        ({ local, type, at }) =>
          `(${type}.store (i32.const $mem.streamState+${at}) (local.get ${local}))`
      )
      .join('\n        ');
    let body = inner.replace(
      new RegExp(`^(\\s*\\${name}\\b)`),
      '$1\n    (local $streamRoot i32)'
    );
    const leading = '(call $lexEmitLeadingContinuation)';
    if (!body.includes(leading)) {
      throw new Error(`${name} has no leading-continuation checkpoint`);
    }
    body = body.replace(
      leading,
      `${leading}\n    (if (i32.and\n          (global.get $streaming)\n          (i32.eqz (global.get $streamDepth)))\n      (then\n        (local.set $streamRoot (i32.const 1))\n        (global.set $streamDepth (i32.const 1))\n        (if (i32.eqz (global.get $streamReset))\n          (then\n            ${load}))))`
    );
    return `(func${body}\n    (if (local.get $streamRoot)\n      (then\n        ${save}\n        (global.set $streamDepth (i32.const 0)))))`;
  });

  // `(const $mem.name <int|$other>[+-<int>])` defines a named address.
  // Addresses live in src/memory.wat so each region moves in one place.
  // References may add a +/- bias; names cannot contain `-`.
  const constExprs = new Map<string, { value: string; bias: number }>();
  code = code.replace(
    /\s*\(\s*const\s+(\$[\w.]+)\s+(\$[\w.]+|\d+)([+-]\d+)?\s*\)/g,
    (_, name, value, bias) => {
      if (constExprs.has(name))
        throw new Error(`Duplicate const ${name} in ${url.pathname}`);
      constExprs.set(name, {
        value,
        bias: bias !== undefined ? Number(bias) : 0,
      });
      return '';
    }
  );
  const constMap = new Map<string, number>();
  const resolveConst = (name: string, pending: Set<string>): number => {
    const resolved = constMap.get(name);
    if (resolved !== undefined) return resolved;
    const expr = constExprs.get(name);
    if (expr === undefined)
      throw new Error(`Const '${name}' is undefined in ${url.pathname}`);
    if (pending.has(name) === true)
      throw new Error(`Const '${name}' is cyclic in ${url.pathname}`);
    pending.add(name);
    const base = /^\d+$/.test(expr.value)
      ? Number(expr.value)
      : resolveConst(expr.value, pending);
    constMap.set(name, base + expr.bias);
    return base + expr.bias;
  };
  for (const name of constExprs.keys()) resolveConst(name, new Set());
  code = code.replace(/(\$[\w.]+)([+-]\d+)?/g, (all, name, bias) => {
    const value = constMap.get(name);
    return value !== undefined ? String(value + Number(bias ?? 0)) : all;
  });
  const stray = code.match(/\$mem\.[\w.]+/);
  if (stray !== null)
    throw new Error(`Const '${stray[0]}' is undefined in ${url.pathname}`);

  // (css-variable-table $Enum <stringBase> <stringEnd> <tableBase> <tableEnd>)
  // emits kebab-case token suffixes and [ptr:u16, length:u8] lookup records.
  code = replaceForm(code, 'css-variable-table', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (m === null)
      throw new Error(`Malformed css-variable-table in ${url.pathname}`);
    const [, enumKey, stringBaseStr, stringEndStr, tableBaseStr, tableEndStr] =
      m;
    const members = enumMap.get(enumKey);
    if (members === undefined)
      throw new Error(
        `css-variable-table references unknown enum '${enumKey}' in ${url.pathname}`
      );
    const stringBase = Number(stringBaseStr);
    const stringEnd = Number(stringEndStr);
    const tableBase = Number(tableBaseStr);
    const tableEnd = Number(tableEndStr);
    const table = new Uint8Array(Object.keys(members).length * 3);
    const suffixes: [string, number][] = Object.entries(members).map(
      ([name, i]) => [name === 'none' ? '' : name.replace(/[._]/g, '-'), i]
    );
    const strings = suffixes
      .filter(
        ([suffix], i) =>
          suffix !== '' &&
          !suffixes.some(([other], j) => i !== j && other.includes(suffix))
      )
      .map(([suffix]) => suffix);
    let blob = '';
    while (strings.length > 0) {
      let best = 0;
      let overlap = 0;
      for (let i = 0; i < strings.length; i++) {
        for (
          let n = Math.min(blob.length, strings[i].length);
          n > overlap;
          n--
        ) {
          if (blob.endsWith(strings[i].slice(0, n))) {
            best = i;
            overlap = n;
            break;
          }
        }
      }
      blob += strings.splice(best, 1)[0].slice(overlap);
    }
    for (const [suffix, i] of suffixes) {
      const ptr = stringBase + blob.indexOf(suffix);
      table[i * 3] = ptr;
      table[i * 3 + 1] = ptr >> 8;
      table[i * 3 + 2] = suffix.length;
    }
    if (
      stringBase + blob.length > stringEnd ||
      tableBase + table.length > tableEnd
    ) {
      throw new Error(
        `css-variable-table exceeds its memory range in ${url.pathname}`
      );
    }
    const data = [...table]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `(data (i32.const ${stringBase}) "${blob}")\n  (data (i32.const ${tableBase}) "${data}")`;
  });

  // `(bitset $Name $Enum <base> (pred "member" ...) ...)` emits one byte per
  // member and one bit per predicate at <base>. It replaces equality ladders
  // with a fixed-cost load and mask.
  code = replaceForm(code, 'bitset', (raw) => {
    const inner = raw.replace(/;;[^\n]*/g, ''); // comments may sit between members
    const head = inner.match(/^\s*(\$\w+)\s+(\$\w+)\s+(\d+)/);
    if (head === null) throw new Error(`Malformed bitset in ${url.pathname}`);
    const [, name, enumKey, baseStr] = head;
    if (bitsetMap.has(name)) throw new Error(`Duplicate bitset ${name}`);
    const members = enumMap.get(enumKey);
    if (members === undefined)
      throw new Error(
        `Bitset '${name}' references unknown enum '${enumKey}' in ${url.pathname}`
      );
    const base = Number(baseStr);
    const bytes = new Uint8Array(Object.keys(members).length);
    const bits: Record<string, number> = {};
    let bit = 0;
    for (const [, pred, list] of inner.matchAll(
      /\((\w+)((?:\s+"[\w.]+")+)\s*\)/g
    )) {
      if (bit > 7) {
        throw new Error(
          `Bitset '${name}' has more than 8 predicates in ${url.pathname}`
        );
      }
      bits[pred] = 1 << bit++;
      for (const q of list.match(/"[\w.]+"/g) ?? []) {
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
    const data = [...bytes]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `;; ${name}: ${Object.keys(bits).join(', ')}\n  (data (i32.const ${base}) "${data}")`;
  });

  // `(keyword-table $Name <base> <end> <buckets> <slots> (group "word" ...) ...)`
  // emits a displacement-based perfect hash table for keyword lookup:
  // [buckets] displacement bytes, [slots] u16 descriptors (len<<11 | recOffset+1),
  // then [group:u8, word bytes] records (7 zero bytes of slack for wide
  // compares). `(keyword-table.get $Name <start> <end>)` looks a word up and
  // returns its 1-based group index, or 0 for a miss. The hash mixes the first
  // two bytes, last byte, and length, so words must be 2..31 bytes long.
  const keywordTables = new Map<
    string,
    { base: number; buckets: number; slots: number }
  >();
  code = replaceForm(code, 'keyword-table', (raw) => {
    const inner = raw.replace(/;;[^\n]*/g, '');
    const head = inner.match(/^\s*(\$\w+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (head === null)
      throw new Error(`Malformed keyword-table in ${url.pathname}`);
    const [, name, baseStr, endStr, bucketsStr, slotsStr] = head;
    if (keywordTables.has(name))
      throw new Error(`Duplicate keyword-table ${name}`);
    const base = Number(baseStr);
    const rangeEnd = Number(endStr);
    const buckets = Number(bucketsStr);
    const slots = Number(slotsStr);
    if ((buckets & (buckets - 1)) !== 0 || (slots & (slots - 1)) !== 0)
      throw new Error(
        `keyword-table ${name}: buckets/slots must be powers of two`
      );
    const words: { word: string; group: number; h: number; desc: number }[] =
      [];
    let group = 0;
    for (const [, list] of inner.matchAll(
      /\(group((?:\s+"[\w.@#!]+")+)\s*\)/g
    )) {
      group += 1;
      if (group > 255)
        throw new Error(`keyword-table ${name} has more than 255 groups`);
      for (const q of list.match(/"[\w.@#!]+"/g) ?? []) {
        const word = JSON.parse(q);
        if (word.length < 2 || word.length > 31)
          throw new Error(
            `keyword-table ${name}: '${word}' must be 2..31 bytes`
          );
        if (words.some((w) => w.word === word))
          throw new Error(`keyword-table ${name}: duplicate word '${word}'`);
        words.push({ word, group, h: 0, desc: 0 });
      }
    }
    if (words.length === 0 || words.length > slots)
      throw new Error(
        `keyword-table ${name}: ${words.length} words for ${slots} slots`
      );
    // the same mix as $lexKeywordLookup computes at runtime
    const hash = (w: string) => {
      let h =
        (w.charCodeAt(0) |
          (w.charCodeAt(1) << 8) |
          (w.charCodeAt(w.length - 1) << 16) |
          (w.length << 24)) >>>
        0;
      h = Math.imul(h ^ (h >>> 16), 0xe51fac89) >>> 0;
      return (h ^ (h >>> 24)) >>> 0;
    };
    // records blob: group byte + exact word bytes, offsets biased by one
    const records: number[] = [];
    let recOffset = 0;
    for (const w of words) {
      w.h = hash(w.word);
      w.desc = (w.word.length << 11) | (recOffset + 1);
      // Code units equal code points here: words are validated ASCII.
      records.push(w.group, ...w.word.split('').map((c) => c.charCodeAt(0)));
      recOffset += 1 + w.word.length;
    }
    if (recOffset + 1 > 2047)
      throw new Error(
        `keyword-table ${name}: records exceed the 11-bit offset`
      );
    // displacement search (CHD): place large buckets first
    const byBucket = new Map<number, typeof words>();
    for (const w of words) {
      const b = w.h & (buckets - 1);
      let bucket = byBucket.get(b);
      if (bucket === undefined) byBucket.set(b, (bucket = []));
      bucket.push(w);
    }
    const disp = new Uint8Array(buckets);
    const table = new Uint16Array(slots);
    const order = [...byBucket.entries()].sort(
      (a, b) => b[1].length - a[1].length
    );
    for (const [b, ws] of order) {
      let placed = false;
      for (let d = 0; d < 256 && !placed; d++) {
        const at = ws.map(
          (w) => (((w.h >>> 4) & (slots - 1)) + d) & (slots - 1)
        );
        if (new Set(at).size === ws.length && at.every((s) => table[s] === 0)) {
          ws.forEach((w, i) => (table[at[i]] = w.desc));
          disp[b] = d;
          placed = true;
        }
      }
      if (!placed)
        throw new Error(
          `keyword-table ${name}: no displacement for bucket ${b}; raise buckets/slots`
        );
    }
    const bytes = [
      ...disp,
      ...[...table].flatMap((v) => [v & 0xff, v >> 8]),
      ...records,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // slack for the lookup's 8-byte-wide tail compare
    ];
    if (base + bytes.length > rangeEnd)
      throw new Error(
        `keyword-table ${name} needs ${bytes.length} bytes, range holds ${rangeEnd - base}`
      );
    keywordTables.set(name, { base, buckets, slots });
    const data = bytes
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `;; ${name}: ${words.length} words, ${bytes.length} bytes\n  (data (i32.const ${base}) "${data}")`;
  });

  // (keyword-table.get $Name <start> <end>) -> the shared lookup call with the
  // table's base and masks filled in
  code = replaceForm(code, 'keyword-table.get', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+([\s\S]+)$/);
    if (m === null)
      throw new Error(`Malformed keyword-table.get in ${url.pathname}`);
    const table = keywordTables.get(m[1]);
    if (table === undefined)
      throw new Error(
        `keyword-table '${m[1]}' is undefined in ${url.pathname}`
      );
    return `(call $lexKeywordLookup ${m[2].trim()} (i32.const ${table.base}) (i32.const ${table.buckets - 1}) (i32.const ${table.slots - 1}))`;
  });

  // (bitset.get $Name.pred <expr>) -> (i32.and (i32.load8_u offset=base <expr>) (i32.const mask))
  code = replaceForm(code, 'bitset.get', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\.(\w+)\s+([\s\S]+)$/);
    if (m === null) throw new Error(`Malformed bitset.get in ${url.pathname}`);
    const [, name, pred, expr] = m;
    const table = bitsetMap.get(name);
    const mask = table?.bits[pred];
    if (table === undefined || mask === undefined)
      throw new Error(
        `Bitset '${name}.${pred}' is undefined in ${url.pathname}`
      );
    return `(i32.and (i32.load8_u offset=${table.base} ${expr.trim()}) (i32.const ${mask}))`;
  });

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
    .replace(/i(32|64).const\s+(".+?")/g, (_, bits, str) => {
      const chars: string = JSON.parse(str);
      if (
        chars.length > Number(bits) / 8 ||
        chars.split('').some((c) => c.charCodeAt(0) > 0xff)
      ) {
        throw new Error(
          `Could not convert '${chars}' to i${bits} in ${url.pathname}`
        );
      }
      // little-endian
      const hex =
        '0x' +
        chars
          .split('')
          .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
          .reverse()
          .join('');
      return `i${bits}.const ${hex}`;
    });
  checkDataSegments(code, url.pathname);
  if (imports.length > 0) {
    code = code.replace(
      /^\s*\(\s*module(\s+)/,
      `(module\n${imports.map((i) => '  ' + i).join('\n')}$1`
    );
  }
  return {
    code,
    enumMap,
    bitsetMap,
    constMap,
  };
}

/**
 * Replace each `(head ...)` form with `fn(innerText)`.
 * Parenthesis scanning preserves nested forms and string operands.
 */
function replaceForm(
  code: string,
  head: string,
  fn: (inner: string) => string
): string {
  const open = new RegExp(
    `\\(\\s*${head.replace(/[.$]/g, '\\$&')}(?=[\\s(])`,
    'g'
  );
  let out = '';
  let last = 0;
  let m;
  while ((m = open.exec(code)) !== null) {
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
    if (depth !== 0) {
      throw new Error(`Unterminated (${head} ...) form at offset ${m.index}`);
    }
    out += code.slice(last, m.index) + fn(code.slice(m.index + m[0].length, i));
    last = i + 1;
    open.lastIndex = last;
  }
  return out + code.slice(last);
}

/**
 * Check that `src/memory.wat` data segments fit in page 1 without overlap.
 * A bad address can silently corrupt another table.
 */
function checkDataSegments(code: string, path: string): void {
  const segments: { base: number; end: number }[] = [];
  const open = /\(\s*data\s+\(\s*i32\.const\s+(\d+)\s*\)/g;
  let m;
  while ((m = open.exec(code)) !== null) {
    let depth = 1,
      i = m.index + m[0].length,
      inStr = false,
      inComment = false,
      length = 0;
    for (; i < code.length && depth !== 0; i++) {
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
    if (seg.end > 65536) {
      throw new Error(
        `data segment [${seg.base}:${seg.end}) overflows page 1 in ${path}`
      );
    }
    const next = segments[i + 1];
    if (next !== undefined && next.base < seg.end) {
      throw new Error(
        `data segments [${seg.base}:${seg.end}) and [${next.base}:${next.end}) overlap in ${path}`
      );
    }
  }
}

/**
 * Compile WAT to WebAssembly.
 */
export function wat2wasm(
  filename: string,
  text: string,
  options?: Record<string, boolean>
): Uint8Array {
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
 * Optimize with Binaryen at `-O3 --shrink-level=1` and emit optimized Stack IR.
 * Each pass exposes more patterns for the next. Pass three still shrinks the
 * module; pass four does not.
 */
export function optimizeWasm(wasmBytes: Uint8Array): Uint8Array {
  binaryen.setOptimizeLevel(3);
  binaryen.setShrinkLevel(1);
  binaryen.setGenerateStackIR(true);
  binaryen.setOptimizeStackIR(true);
  for (let pass = 0; pass < 3; pass++) {
    const wasmModule = binaryen.readBinary(wasmBytes);
    try {
      // Match wat2wasm features so Binaryen does not emit instructions the
      // target runtimes cannot execute.
      wasmModule.setFeatures(
        binaryen.Features.BulkMemory |
          binaryen.Features.BulkMemoryOpt |
          binaryen.Features.SIMD128
      );
      if (Boolean(wasmModule.validate()) === false) {
        throw new Error('binaryen rejected the module');
      }
      wasmModule.optimize();
      wasmBytes = wasmModule.emitBinary();
    } finally {
      wasmModule.dispose();
    }
  }
  return wasmBytes;
}

/**
 * Return `$Token` names in table order. Each index is a theme-table slot, so
 * this order defines the JavaScript/WebAssembly theme ABI.
 */
export function listTokenTypes(
  enumMap: Map<string, Record<string, number>>
): string[] {
  const hl = enumMap.get('$Token');
  if (hl === undefined) throw new Error('no $Token enum found');
  const names = Object.keys(hl);
  names.forEach((name, i) => {
    if (hl[name] !== i) throw new Error(`$Token enum is not dense at ${name}`);
  });
  return names;
}

/** Write `content` to `url` only when it differs, keeping mtimes stable. */
function writeIfChanged(url: URL, content: string): void {
  let current;
  try {
    current = readFileSync(url, 'utf-8');
  } catch {
    current = undefined;
  }
  if (current !== content) writeFileSync(url, content, 'utf-8');
}

// Build dist/chamele.wasm when this script runs directly.
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  try {
    const { code, enumMap } = transformWat(
      new URL('../src/chamele.wat', moduleUrl)
    );
    mkdirSync(new URL('../dist/', moduleUrl), { recursive: true });
    writeFileSync(new URL('../dist/chamele.wat', moduleUrl), code, 'utf-8');
    const rawBytes = wat2wasm(
      new URL('../dist/chamele.wasm', moduleUrl).pathname,
      code
    );
    const wasmBytes = optimizeWasm(rawBytes);
    writeFileSync(new URL('../dist/chamele.wasm', moduleUrl), wasmBytes);
    writeFileSync(
      new URL('../dist/chamele.wasm.mjs', moduleUrl),
      `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
        `const b = new Uint8Array(s.length);\n` +
        `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
        `export default b;\n`,
      'utf-8'
    );
    // The `$Token` order is the theme-table ABI; regenerate the glue copy,
    // which tsdown then compiles into dist/ with the rest of lib/.
    writeIfChanged(
      new URL('../lib/token-types.ts', moduleUrl),
      '// generated by scripts/build.ts - do not edit\n' +
        'const tokenTypes: readonly string[] = [\n' +
        listTokenTypes(enumMap)
          .map((name) => `  '${name}',`)
          .join('\n') +
        '\n];\n\nexport default tokenTypes;\n'
    );
    // Save raw and gzipped Wasm sizes in package.json metadata.
    const pkgUrl = new URL('../package.json', moduleUrl);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8'));
    pkg.meta = {
      'chamele.wasm': wasmBytes.length,
      'chamele.wasm.gz': gzipSync(wasmBytes, { level: 9 }).length,
    };
    writeIfChanged(pkgUrl, JSON.stringify(pkg, null, 2) + '\n');
    console.log(
      `✨ Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${pkg.meta['chamele.wasm']} bytes, gzipped: ${
        pkg.meta['chamele.wasm.gz']
      } bytes, -O3)`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
