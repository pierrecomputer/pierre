import binaryen from 'binaryen';
import { readFileSync } from 'node:fs';
import wabt from 'wabt';

const { parseWat, readWasm } = await wabt();

/** Enum members by name, for each `$Enum`. */
export type EnumMap = Map<string, Record<string, number>>;
/** The base address and predicate masks of each `$Bitset`. */
export type BitsetMap = Map<
  string,
  { base: number; bits: Record<string, number> }
>;

/** Binaryen settings, and the name wabt reports errors under. */
export interface OptimizeOptions {
  filename: string;
  shrinkLevel: number;
  flexibleInlineMaxSize?: number;
  oneCallerInlineMaxSize?: number;
}

/**
 * Remove WAT line comments and nested block comments.
 * Preserve string literals and line breaks.
 */
function stripComments(src: string): string {
  let out = '';
  let last = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === ';' && src[i + 1] === ';') {
      out += src.slice(last, i);
      while (i < src.length && src[i] !== '\n') i++;
      last = i;
    } else if (c === '(' && src[i + 1] === ';') {
      out += src.slice(last, i);
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '(' && src[i + 1] === ';') {
          depth++;
          i += 2;
        } else if (src[i] === ';' && src[i + 1] === ')') {
          depth--;
          i += 2;
        } else i++;
      }
      out += ' ';
      last = i;
    } else {
      i++;
    }
  }
  return out + src.slice(last);
}

/**
 * Inline local `.wat` imports and lift function imports out of the text, for the
 * caller to restore after its passes. Comments go first, per file, so no pass can
 * match a form, import, enum, or string literal that only appears in a comment.
 */
export function flattenWat(
  url: URL,
  content: string
): { code: string; imports: string[] } {
  const imports: string[] = [];
  const seen = new Set([url.href]);
  const flatten = (moduleUrl: URL, source: string): string =>
    stripComments(source).replace(
      /\(\s*import\s+"(\.+\/.+\.wat)"\s*\)/g,
      (_, path) => {
        const importUrl = new URL(path, moduleUrl);
        if (seen.has(importUrl.href)) return '';
        seen.add(importUrl.href);
        return flatten(importUrl, readFileSync(importUrl, 'utf-8')).replace(
          /^\s*\(\s*module\s+([\s\S]+)\s*\)\s*$/,
          '$1'
        );
      }
    );
  const code = flatten(url, content).replace(
    /\(\s*import +".+" +\( *func.+\)/g,
    (i) => {
      imports.push(i);
      return '';
    }
  );
  return { code, imports };
}

/** Read `(enum $Name "member" ...)` forms into `enumMap` and remove them. */
export function expandEnums(code: string, enumMap: EnumMap): string {
  return code.replace(
    /\s*\(\s*enum\s+(\$\w+)\s+([^)]+)\s*\)/g,
    (_, key, members) => {
      if (enumMap.has(key)) throw new Error(`Duplicate enum ${key}`);
      let i = 0;
      enumMap.set(
        key,
        Object.fromEntries(
          members
            .split(/\s+/g)
            .map((l: string) => l.trim())
            .filter((l: string) => l !== '' && /^"[\w.-]+"$/.test(l))
            .map((l: string): [string, number] => [
              JSON.parse(l) as string,
              i++,
            ])
        )
      );
      return '';
    }
  );
}

/**
 * Resolve `(const $name <int|$other>[+-<int>])` forms and substitute every
 * reference. `$mem.` names are addresses, declared once so each region moves in
 * one place. References may add a +/- bias, so names cannot contain `-`.
 */
export function resolveConsts(
  code: string,
  path: string
): { code: string; constMap: Map<string, number> } {
  const constExprs = new Map<string, { value: string; bias: number }>();
  code = code.replace(
    /\s*\(\s*const\s+(\$[\w.]+)\s+(\$[\w.]+|\d+)([+-]\d+)?\s*\)/g,
    (_, name, value, bias) => {
      if (constExprs.has(name))
        throw new Error(`Duplicate const ${name} in ${path}`);
      constExprs.set(name, {
        value,
        bias: bias !== undefined ? Number(bias) : 0,
      });
      return '';
    }
  );
  const constMap = new Map<string, number>();
  const resolve = (name: string, pending: Set<string>): number => {
    const resolved = constMap.get(name);
    if (resolved !== undefined) return resolved;
    const expr = constExprs.get(name);
    if (expr === undefined)
      throw new Error(`Const '${name}' is undefined in ${path}`);
    if (pending.has(name))
      throw new Error(`Const '${name}' is cyclic in ${path}`);
    pending.add(name);
    const base = /^\d+$/.test(expr.value)
      ? Number(expr.value)
      : resolve(expr.value, pending);
    constMap.set(name, base + expr.bias);
    return base + expr.bias;
  };
  for (const name of constExprs.keys()) resolve(name, new Set());
  code = code.replace(/(\$[\w.]+)([+-]\d+)?/g, (all, name, bias) => {
    const value = constMap.get(name);
    return value !== undefined ? String(value + Number(bias ?? 0)) : all;
  });
  const stray = code.match(/\$mem\.[\w.]+/);
  if (stray !== null)
    throw new Error(`Const '${stray[0]}' is undefined in ${path}`);
  return { code, constMap };
}

/** A data segment, with every byte escaped so the WAT text stays 7-bit clean. */
export function dataSegment(base: number, bytes: Iterable<number>): string {
  let out = '';
  for (const b of bytes) out += '\\' + b.toString(16).padStart(2, '0');
  return `(data (i32.const ${base}) "${out}")`;
}

/**
 * Expand `(bitset $Name $Enum <base> (pred "member" ...) ...)` into one byte per
 * enum member and one bit per predicate at <base>. It replaces equality ladders
 * with a fixed-cost load and mask.
 */
export function expandBitsets(
  code: string,
  enumMap: EnumMap,
  bitsetMap: BitsetMap,
  path: string
): string {
  return replaceForm(code, 'bitset', (raw) => {
    const head = raw.match(/^\s*(\$\w+)\s+(\$\w+)\s+(\d+)/);
    if (head === null) throw new Error(`Malformed bitset in ${path}`);
    const [, name, enumKey, baseStr] = head;
    if (bitsetMap.has(name)) throw new Error(`Duplicate bitset ${name}`);
    const members = enumMap.get(enumKey);
    if (members === undefined)
      throw new Error(
        `Bitset '${name}' references unknown enum '${enumKey}' in ${path}`
      );
    const base = Number(baseStr);
    const bytes = new Uint8Array(Object.keys(members).length);
    const bits: Record<string, number> = {};
    let bit = 0;
    for (const [, pred, list] of raw.matchAll(
      /\((\w+)((?:\s+"[\w.]+")+)\s*\)/g
    )) {
      if (bit > 7)
        throw new Error(
          `Bitset '${name}' has more than 8 predicates in ${path}`
        );
      bits[pred] = 1 << bit++;
      for (const q of list.match(/"[\w.]+"/g) ?? []) {
        const member = JSON.parse(q);
        if (members[member] === undefined)
          throw new Error(
            `Bitset '${name}.${pred}': '${member}' is not in enum '${enumKey}' in ${path}`
          );
        bytes[members[member]] |= bits[pred];
      }
    }
    bitsetMap.set(name, { base, bits });
    return dataSegment(base, bytes);
  });
}

/** Expand `(bitset.get $Name.pred <expr>)` into a load and mask. */
export function expandBitsetGets(
  code: string,
  bitsetMap: BitsetMap,
  path: string
): string {
  return replaceForm(code, 'bitset.get', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\.(\w+)\s+([\s\S]+)$/);
    if (m === null) throw new Error(`Malformed bitset.get in ${path}`);
    const [, name, pred, expr] = m;
    const table = bitsetMap.get(name);
    const mask = table?.bits[pred];
    if (table === undefined || mask === undefined)
      throw new Error(`Bitset '${name}.${pred}' is undefined in ${path}`);
    return `(i32.and (i32.load8_u offset=${table.base} ${expr.trim()}) (i32.const ${mask}))`;
  });
}

/** A little-endian integer literal for up to 8 latin-1 characters. */
export function packLe(chars: string): string {
  let hex = '';
  for (const c of chars) {
    const b = c.charCodeAt(0);
    if (b > 0xff) throw new Error(`'${chars}' is not a byte string`);
    hex = b.toString(16).padStart(2, '0') + hex;
  }
  return '0x' + (hex !== '' ? hex : '00');
}

/** Decode a WAT string literal (\\xx, \\n, \\t, \\r, \\", \\\\) into latin-1 characters. */
export function parseWatString(raw: string, path: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2)
    throw new Error(`Expected a string literal, got ${raw} in ${path}`);
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
    else if (/[0-9a-fA-F]/.test(n) && /[0-9a-fA-F]/.test(raw[i + 1]))
      out += String.fromCharCode(parseInt(n + raw[++i], 16));
    else throw new Error(`Bad escape in ${raw} (${path})`);
  }
  return out;
}

/** Expand `enum.get` forms and string operands of `i32.const` and `i64.const`. */
export function expandEnumGetsAndStrings(
  code: string,
  enumMap: EnumMap,
  path: string
): string {
  return code
    .replace(
      /(\(\s*)enum\.get\s+(\$\w+)\.([\w.-]+)/g,
      (_, prefix, key, memberName) => {
        const i = enumMap.get(key)?.[memberName];
        if (i === undefined)
          throw new Error(
            `Enum '${key}.${memberName}' is undefined in ${path}`
          );
        return prefix + 'i32.const ' + i;
      }
    )
    .replace(/i(32|64)\.const\s+("(?:[^"\\]|\\.)*")/g, (_, bits, str) => {
      const chars = parseWatString(str, path);
      if (chars.length > Number(bits) / 8)
        throw new Error(`Could not convert '${chars}' to i${bits} in ${path}`);
      return `i${bits}.const ${packLe(chars)}`;
    });
}

/**
 * Split text into top-level forms and bare atoms with their source offsets.
 * Include each form's head word. Respect comments and string literals.
 */
export function splitTopLevelForms(
  text: string
): { head: string; text: string; start: number; end: number }[] {
  const out: { head: string; text: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === ';' && text[i + 1] === ';') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '(') {
      const start = i;
      let depth = 0,
        inStr = false,
        inComment = false;
      for (; i < text.length; i++) {
        const d = text[i];
        if (inComment) {
          if (d === '\n') inComment = false;
        } else if (inStr) {
          if (d === '\\') i++;
          else if (d === '"') inStr = false;
        } else if (d === '"') inStr = true;
        else if (d === ';' && text[i + 1] === ';') inComment = true;
        else if (d === '(') depth++;
        else if (d === ')' && --depth === 0) break;
      }
      if (depth !== 0) throw new Error('unterminated form');
      i++;
      const form = text.slice(start, i);
      out.push({
        head: form.slice(1).match(/^\s*([\w.$-]+)/)?.[1] ?? '',
        text: form,
        start,
        end: i,
      });
    } else if (c === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i++;
      out.push({ head: '', text: text.slice(start, i), start, end: i });
    } else {
      const start = i;
      while (i < text.length && !/[\s()]/.test(text[i])) i++;
      out.push({ head: '', text: text.slice(start, i), start, end: i });
    }
  }
  return out;
}

/**
 * Replace each `(head ...)` form with `fn(innerText, offset)`, where offset
 * is the form's start in `code`.
 * Skip quoted strings when matching, and preserve nested forms and operands.
 */
export function replaceForm(
  code: string,
  head: string,
  fn: (inner: string, at: number) => string
): string {
  const open = new RegExp(
    `"(?:[^"\\\\]|\\\\.)*"|\\(\\s*${head.replace(/[.$]/g, '\\$&')}(?=[\\s(])`,
    'g'
  );
  let out = '';
  let last = 0;
  let m;
  while ((m = open.exec(code)) !== null) {
    if (m[0].startsWith('"')) continue;
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
    out +=
      code.slice(last, m.index) +
      fn(code.slice(m.index + m[0].length, i), m.index);
    last = i + 1;
    open.lastIndex = last;
  }
  return out + code.slice(last);
}

/**
 * Work around a JavaScriptCore ARM64 bug in compound boolean expressions.
 * Replace `(i32.eqz X)` for and/or expressions with
 * `(i32.shr_u (i32.clz X) (i32.const 5))`. Both return 1 only for zero.
 * JavaScriptCore can leave stale comparisons when conditional-compare
 * fusion fails. This produces incorrect branch flags. The clz form stops
 * fusion and preserves boolean arithmetic.
 *
 * Apply before and after Binaryen, which can reconstruct the affected form.
 * Remove this workaround when the pinned Bun includes WebKit's fix.
 */
export function wrapCompoundNegations(code: string): string {
  return replaceForm(code, 'i32.eqz', (inner) => {
    // nested negations first, so an inner compound is wrapped as well
    const arg = wrapCompoundNegations(inner).trim();
    if (!/^\(\s*i32\.(?:and|or)\b/.test(arg)) return `(i32.eqz ${arg})`;
    return `(i32.shr_u (i32.clz ${arg}) (i32.const 5))`;
  });
}

/**
 * Add an unused `v128` local to scalar functions that can call SIMD code.
 * JavaScriptCore selects a register convention from each function's own
 * bytecode, but can then inline SIMD callees. With the scalar convention,
 * ARM64 calls preserve only 64 bits of some vector registers.
 * This corrupts inlined scanner constants and can truncate 16-byte scans.
 *
 * The local selects the SIMD convention without adding instructions.
 * A dropped vector load also works, but its size can prevent inlining.
 * Binaryen removes unused locals, so optimizeWasm applies this again
 * after optimization, when calls refer to function indices.
 */
export function markSimdReachers(code: string): string {
  const simdOp =
    /\b(?:v128|[if](?:8x16|16x8|32x4|64x2))\.|\(\s*local\b[^()]*\bv128\b/;
  const header = new Set(['export', 'type', 'param', 'result', 'local']);
  const moduleForm = splitTopLevelForms(code).find((f) => f.head === 'module');
  if (moduleForm === undefined) throw new Error('markSimdReachers: no module');
  const innerAt =
    moduleForm.start + moduleForm.text.indexOf('module') + 'module'.length;
  const inner = code.slice(innerAt, moduleForm.end - 1);
  const forms = splitTopLevelForms(inner);
  // imported functions come first in the index space that `call N` uses
  const imported = forms.filter(
    (f) => f.head === 'import' && /\(\s*func\b/.test(f.text)
  ).length;
  const funcs = forms
    .filter((f) => f.head === 'func')
    .map((f) => {
      const open = /^\(\s*func(?:\s+(\$[^\s()]+))?/.exec(f.text);
      if (open === null) throw new Error('markSimdReachers: malformed func');
      // string literals cannot hold instructions; blank them before matching
      const text = f.text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
      return {
        form: f,
        openLen: open[0].length,
        name: open[1],
        simd: simdOp.test(text),
        callees: [...text.matchAll(/\bcall\s+(\$[^\s()]+|\d+)/g)].map(
          (m) => m[1]
        ),
        indirect: /\bcall_indirect\b/.test(text),
      };
    });
  // exported entry points may be unnamed, so track functions by index
  const index = new Map(funcs.map((f, i) => [f.name, i]));
  const resolve = (callee: string): number | undefined =>
    /^\d+$/.test(callee) ? Number(callee) - imported : index.get(callee);
  const reaches = new Set(funcs.flatMap((f, i) => (f.simd ? [i] : [])));
  for (let changed = true; changed; ) {
    changed = false;
    for (const [i, f] of funcs.entries()) {
      if (reaches.has(i)) continue;
      const callsReacher = f.callees.some((c) => {
        const j = resolve(c);
        return j !== undefined && reaches.has(j);
      });
      if (f.indirect || callsReacher) {
        reaches.add(i);
        changed = true;
      }
    }
  }
  // splice the local in after the declarations, from the end so earlier
  // offsets stay valid; an appended local leaves existing indices alone
  let out = code;
  for (const [i, f] of [...funcs.entries()].reverse()) {
    if (f.simd || !reaches.has(i)) continue;
    const body = f.form.text.slice(f.openLen, -1);
    const first = splitTopLevelForms(body).find(
      (x) => !header.has(x.head) && !x.text.startsWith('(;')
    );
    const at =
      innerAt + f.form.start + f.openLen + (first?.start ?? body.length);
    out = `${out.slice(0, at)} (local v128)${out.slice(at)}`;
  }
  return out;
}

/**
 * Find functions that break the JavaScriptCore invariant behind markSimdReachers:
 * a direct caller of a SIMD function uses SIMD itself, through an instruction or
 * a v128 local. This covers transitive callers by induction. Named and index
 * calls both work, so optimized modules can be checked.
 */
export function findSimdCallersWithoutSimd(text: string): {
  functions: number;
  simd: number;
  violations: string[];
} {
  const usesSimd =
    /\b(?:v128|[if](?:8x16|16x8|32x4|64x2))\.|\(local\b[^()]*\bv128\b/;
  const imported = (text.match(/\(import\b[^\n]*\(func\b/g) ?? []).length;
  const starts = [...text.matchAll(/^\s*\(func(?:\s+(\$[^\s()]+))?/gm)];
  const funcs = starts.map((m, i) => ({
    name: m[1] ?? `#${i + imported}`,
    body: text
      .slice(m.index, starts[i + 1]?.index ?? text.length)
      .replace(/"(?:[^"\\]|\\.)*"/g, '""'),
  }));
  const simd = new Set(
    funcs.flatMap((f, i) =>
      usesSimd.test(f.body) ? [f.name, `#${i + imported}`] : []
    )
  );
  const violations: string[] = [];
  for (const f of funcs) {
    if (simd.has(f.name)) continue;
    if (/\bcall_indirect\b/.test(f.body))
      violations.push(`${f.name} uses call_indirect without using SIMD`);
    for (const [, callee] of f.body.matchAll(/\bcall\s+(\$[^\s()]+|\d+)/g)) {
      const name = /^\d+$/.test(callee) ? `#${callee}` : callee;
      if (simd.has(name))
        violations.push(`${f.name} calls ${name} without using SIMD`);
    }
  }
  return { functions: funcs.length, simd: simd.size, violations };
}

/**
 * Check that data segments end below `limit` and do not overlap. A bad address
 * would silently corrupt another table.
 */
export function checkDataSegments(
  code: string,
  path: string,
  limit: number
): void {
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
        else {
          // wabt emits UTF-8, so a non-ASCII character is several bytes
          const cp = code.codePointAt(i) ?? 0;
          length += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
          if (cp > 0xffff) i++;
        }
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
    if (seg.end > limit) {
      throw new Error(
        `data segment [${seg.base}:${seg.end}) overflows the static region in ${path}`
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

export function wat2wasm(filename: string, text: string): Uint8Array {
  const wasmModule = parseWat(filename, text, {
    bulk_memory: true,
    simd: true,
  });
  try {
    return wasmModule.toBinary({}).buffer;
  } finally {
    wasmModule.destroy();
  }
}

/** Folded WAT text of a WebAssembly binary, for build-invariant tests. */
export function wasmToText(wasmBytes: Uint8Array): string {
  const wasmModule = readWasm(wasmBytes, { readDebugNames: false });
  try {
    return wasmModule.toText({ foldExprs: true, inlineExport: false });
  } finally {
    wasmModule.destroy();
  }
}

/**
 * Optimize with Binaryen at `-O3`, then rewrite the folded text. Three passes
 * shrink the module. A fourth does not.
 */
export function optimizeWasm(
  wasmBytes: Uint8Array,
  options: OptimizeOptions
): Uint8Array {
  binaryen.setOptimizeLevel(3);
  binaryen.setShrinkLevel(options.shrinkLevel);
  if (options.flexibleInlineMaxSize !== undefined)
    binaryen.setFlexibleInlineMaxSize(options.flexibleInlineMaxSize);
  if (options.oneCallerInlineMaxSize !== undefined)
    binaryen.setOneCallerInlineMaxSize(options.oneCallerInlineMaxSize);
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
  // Binaryen turns byte splats into 18-byte vector constants, so restore the
  // 4-5-byte scalar splat. Its passes also undo compound-negation rewrites and
  // SIMD markers, so apply those again.
  const compact = replaceForm(wasmToText(wasmBytes), 'v128.const', (inner) => {
    const byte = inner.match(
      /^\s*i32x4 (0x([0-9a-f]{2})\2\2\2) \1 \1 \1\s*$/
    )?.[2];
    return byte === undefined
      ? `(v128.const${inner})`
      : `(i8x16.splat (i32.const ${(parseInt(byte, 16) << 24) >> 24}))`;
  });
  return wat2wasm(
    options.filename,
    markSimdReachers(wrapCompoundNegations(compactMaskedCompares(compact)))
  );
}

/**
 * Replace masked-word comparisons with xor, shift, and eqz:
 * `(i64.eq (i64.and X (i64.const 2^n-1)) (i64.const C))` becomes
 * `(i64.eqz (i64.shl (i64.xor X (i64.const C)) (i64.const 64-n)))`.
 * C must fit the mask. Shifting removes the same high bits as masking
 * and avoids the large mask constant. Handle 5-7-byte i64 masks,
 * 3-byte i32 masks, and `ne` with a second `eqz`.
 */
function compactMaskedCompares(code: string): string {
  const widths: Record<string, number> = {
    i64: 64,
    i32: 32,
  };
  const maskBytes = (width: number, value: bigint): number => {
    for (const bytes of width === 64 ? [5, 6, 7] : [3]) {
      if (value === (1n << BigInt(bytes * 8)) - 1n) return bytes;
    }
    return 0;
  };
  const rewrite = (type: string, op: string) => (inner: string) => {
    const nested = compactMaskedCompares(inner);
    const forms = splitTopLevelForms(nested);
    const fallback = `(${type}.${op}${nested})`;
    if (forms.length !== 2) return fallback;
    const width = widths[type];
    const constant = new RegExp(`^\\(${type}\\.const (-?\\d+)\\)$`);
    for (const [masked, other] of [forms, [forms[1], forms[0]]]) {
      const c = constant.exec(other.text.trim());
      if (c === null || masked.head !== `${type}.and`) continue;
      const parts = splitTopLevelForms(
        masked.text.slice(masked.text.indexOf('and') + 3, -1)
      );
      if (parts.length !== 2) continue;
      const m = constant.exec(parts[1].text.trim());
      if (m === null) continue;
      const bytes = maskBytes(width, BigInt(m[1]));
      const value = BigInt(c[1]);
      if (bytes === 0 || value < 0n || value >> BigInt(bytes * 8) !== 0n)
        continue;
      const zero = `(${type}.eqz (${type}.shl (${type}.xor ${parts[0].text} (${type}.const ${c[1]})) (${type}.const ${width - bytes * 8})))`;
      return op === 'eq' ? zero : `(i32.eqz ${zero})`;
    }
    return fallback;
  };
  for (const type of Object.keys(widths)) {
    for (const op of ['eq', 'ne']) {
      code = replaceForm(code, `${type}.${op}`, rewrite(type, op));
    }
  }
  return code;
}
