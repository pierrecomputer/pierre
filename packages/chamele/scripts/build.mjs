#!/usr/bin/env node

import binaryen from 'binaryen';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import wabt from 'wabt';

const { parseWat } = await wabt();

/**
 * transform the given wat file, to support:
 * - import other wat files
 * - define enums
 * - define named memory addresses (`const`, see src/memory.wat)
 * - emit CSS-variable strings for an enum (`css-variable-table`)
 * - define bit-per-predicate lookup tables over an enum (`bitset`)
 * - convert i32/i64.const string operands to integer literals
 * @param {string|URL} url
 * @param {string} [content] wat text; read from `url` when omitted
 * @returns {{code: string, enumMap: Map<string, Record<string, number>>, bitsetMap: Map<string, {base: number, bits: Record<string, number>}>, constMap: Map<string, number>}}
 */
export function transformWat(url, content) {
  if (!(url instanceof URL)) url = pathToFileURL(url);
  if (content === undefined) content = readFileSync(url, 'utf-8');
  const enumMap = new Map();
  const bitsetMap = new Map();
  const imports = [];
  const seen = new Set([url.href]);
  const flatten = (moduleUrl, source) =>
    source.replace(/\(\s*import\s+"(\.+\/.+\.wat)"\s*\)/g, (_, path) => {
      const importUrl = new URL(path, moduleUrl);
      if (seen.has(importUrl.href)) return '';
      seen.add(importUrl.href);
      return flatten(importUrl, readFileSync(importUrl, 'utf-8')).replace(
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
    .replace(/\s*\(\s*enum\s+(\$\w+)\s+([^\)]+)\s*\)/g, (_, key, members) => {
      if (enumMap.has(key)) throw new Error(`Duplicate enum ${key}`);
      let i = 0;
      enumMap.set(
        key,
        Object.fromEntries(
          members
            .split(/\s+/g)
            .map((l) => l.trim())
            .filter((l) => l && /^\"[\w.]+\"$/.test(l))
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

  // (css-variable-table $Enum <stringBase> <stringEnd> <tableBase> <tableEnd>)
  // emits kebab-case token suffixes and [ptr:u16, length:u8] lookup records.
  code = replaceForm(code, 'css-variable-table', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/);
    if (!m) throw new Error(`Malformed css-variable-table in ${url.pathname}`);
    const [, enumKey, stringBaseStr, stringEndStr, tableBaseStr, tableEndStr] =
      m;
    const members = enumMap.get(enumKey);
    if (!members)
      throw new Error(
        `css-variable-table references unknown enum '${enumKey}' in ${url.pathname}`
      );
    const stringBase = Number(stringBaseStr);
    const stringEnd = Number(stringEndStr);
    const tableBase = Number(tableBaseStr);
    const tableEnd = Number(tableEndStr);
    const table = new Uint8Array(Object.keys(members).length * 3);
    const suffixes = Object.entries(members).map(([name, i]) => [
      name === 'none' ? '' : name.replace(/[._]/g, '-'),
      i,
    ]);
    const strings = suffixes
      .filter(
        ([suffix], i) =>
          suffix &&
          !suffixes.some(([other], j) => i !== j && other.includes(suffix))
      )
      .map(([suffix]) => suffix);
    let blob = '';
    while (strings.length) {
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
      if (bit > 7) {
        throw new Error(
          `Bitset '${name}' has more than 8 predicates in ${url.pathname}`
        );
      }
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
    const data = [...bytes]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `;; ${name}: ${Object.keys(bits).join(', ')}\n  (data (i32.const ${base}) "${data}")`;
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
      const chars = JSON.parse(str);
      if (
        chars.length > Number(bits) / 8 ||
        [...chars].some((c) => c.charCodeAt(0) > 0xff)
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
  if (imports.length) {
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
 * assert the static tables of src/memory.wat still tile page 1: every data
 * segment must stay inside it and no two may overlap. A mistyped address in
 * the layout would otherwise corrupt another language's table silently.
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
    if (seg.end > 65536) {
      throw new Error(
        `data segment [${seg.base}:${seg.end}) overflows page 1 in ${path}`
      );
    }
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
 * use Binaryen's optimized Stack IR writer for the final encoding.
 * The pipeline runs three times: re-reading an optimized binary lets the
 * next pass fold patterns the previous one exposed (the third pass still
 * shrinks the module measurably; a fourth does not).
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
      if (!wasmModule.validate()) {
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
 * the ordered `$Token` token-type names: the index of a name is its slot in the
 * wasm theme table, so this list IS the theme ABI shared with the JS glue
 * @param {Map<string, Record<string, number>>} enumMap
 * @returns {string[]}
 */
export function listTokenTypes(enumMap) {
  const hl = enumMap.get('$Token');
  if (!hl) throw new Error('no $Token enum found');
  const names = Object.keys(hl);
  names.forEach((name, i) => {
    if (hl[name] !== i) throw new Error(`$Token enum is not dense at ${name}`);
  });
  return names;
}

// Build chamele.wasm when this script is executed directly.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  try {
    const { code, enumMap } = transformWat(
      new URL('../src/chamele.wat', moduleUrl)
    );
    writeFileSync(new URL('../lib/chamele.wat', moduleUrl), code, 'utf-8');
    const rawBytes = wat2wasm(
      new URL('../lib/chamele.wasm', moduleUrl).pathname,
      code
    );
    const wasmBytes = optimizeWasm(rawBytes);
    writeFileSync(new URL('../lib/chamele.wasm', moduleUrl), wasmBytes);
    writeFileSync(
      new URL('../lib/chamele.wasm.mjs', moduleUrl),
      `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
        `const b = new Uint8Array(s.length);\n` +
        `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
        `export default b;\n`,
      'utf-8'
    );
    // the $Token member order is the theme-table ABI: regenerate the glue's copy
    writeFileSync(
      new URL('../lib/token-types.mjs', moduleUrl),
      '// generated by scripts/build.mjs - do not edit\n' +
        `export default ${JSON.stringify(listTokenTypes(enumMap), null, 2).replace(/\n]$/, ',\n]')};\n`,
      'utf-8'
    );
    // record the wasm sizes in package.json "meta"
    const pkgUrl = new URL('../package.json', moduleUrl);
    const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8'));
    pkg.meta = {
      'chamele.wasm': wasmBytes.length,
      'chamele.wasm.gz': gzipSync(wasmBytes, { level: 9 }).length,
    };
    writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
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
