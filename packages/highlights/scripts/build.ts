import binaryen from 'binaryen';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'url';
import wabt from 'wabt';

const { parseWat } = await wabt();

/** The expanded module text and its resolved enums. */
export interface TransformedWat {
  code: string;
  enumMap: Map<string, Record<string, number>>;
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

  // `(byte-switch (local.get $c) (case <byte>... body...) ...)` dispatches on
  // a byte with one br_table instead of a chain of equality tests. Each case
  // lists its bytes - string or numeric constants - before its body; a body
  // that neither branches out nor returns falls through to the code after the
  // switch, exactly like the if-chain it replaces. Cases nest as blocks in
  // source order, with a shared default label wrapping them.
  let byteSwitches = 0;
  code = replaceForm(code, 'byte-switch', (inner) => {
    const forms = splitTopLevelForms(inner);
    const scrutinee = forms[0]?.text;
    if (scrutinee === undefined || !/^\(local\.get\s+\$\w+\)$/.test(scrutinee))
      throw new Error(
        `byte-switch needs a local.get scrutinee in ${url.pathname}`
      );
    const id = byteSwitches++;
    const cases: { body: string; label: string }[] = [];
    const owner = new Map<number, number>();
    for (const form of forms.slice(1)) {
      if (form.head !== 'case')
        throw new Error(`byte-switch expects case forms in ${url.pathname}`);
      const parts = splitTopLevelForms(form.text.slice(5, -1));
      let keys = 0;
      let bodyAt = 0;
      for (const part of parts) {
        if (part.text.startsWith('(')) break;
        bodyAt = part.end;
        const b = part.text.startsWith('"')
          ? unescapeWatString(part.text)
          : [Number(part.text)];
        if (b.length !== 1 || !Number.isInteger(b[0]) || b[0] < 0 || b[0] > 255)
          throw new Error(
            `byte-switch case key ${part.text} is not a byte in ${url.pathname}`
          );
        if (owner.has(b[0]))
          throw new Error(
            `byte-switch lists byte ${b[0]} twice in ${url.pathname}`
          );
        owner.set(b[0], cases.length);
        keys++;
      }
      if (keys === 0)
        throw new Error(`byte-switch case without keys in ${url.pathname}`);
      cases.push({
        body: form.text.slice(5 + bodyAt, -1),
        label: `$byteSwitch${id}_${cases.length}`,
      });
    }
    if (cases.length === 0)
      throw new Error(`byte-switch has no cases in ${url.pathname}`);
    const lo = Math.min(...owner.keys());
    const hi = Math.max(...owner.keys());
    const fallback = `$byteSwitch${id}_default`;
    const targets: string[] = [];
    for (let b = lo; b <= hi; b++) {
      const c = owner.get(b);
      targets.push(c === undefined ? fallback : cases[c].label);
    }
    // bytes below `lo` wrap around to a large index and take the default
    let out = `(br_table ${targets.join(' ')} ${fallback} (i32.sub ${scrutinee} (i32.const ${lo})))`;
    for (const c of cases)
      out = `(block ${c.label}\n${out})\n${c.body}\n(br ${fallback})`;
    return `(block ${fallback}\n${out})`;
  });

  // Preserve top-level lexer locals between streaming calls. Nested lexers
  // used for embedded ranges see a non-zero depth and stay ordinary bounded
  // calls. TypeScript has its own resumable state machine. Only the locals
  // that are live at the checkpoint - read on some path before they are
  // written, so their value carries over from the previous chunk - are saved
  // and restored; scratch locals that every iteration recomputes cost
  // nothing. See liveLocalsAtCheckpoint.
  const streamLexers = new Set([
    '$hlAsm',
    '$hlAstro',
    '$hlBash',
    '$hlC',
    '$hlC3',
    '$hlClojure',
    '$hlCmake',
    '$hlCpp',
    '$hlCsharp',
    '$hlCssImpl',
    '$hlDart',
    '$hlDiff',
    '$hlDockerfile',
    '$hlElixir',
    '$hlErlang',
    '$hlFsharp',
    '$hlGleam',
    '$hlGlsl',
    '$hlGo',
    '$hlGraphql',
    '$hlGroovy',
    '$hlHaskell',
    '$hlHlsl',
    '$hlHtml',
    '$hlJava',
    '$hlJson',
    '$hlJulia',
    '$hlKotlin',
    '$hlLisp',
    '$hlLua',
    '$hlMakefile',
    '$hlMarkdown',
    '$hlMatlab',
    '$hlMdx',
    '$hlNix',
    '$hlObjc',
    '$hlOcaml',
    '$hlPascal',
    '$hlPerl',
    '$hlPhp',
    '$hlPowershell',
    '$hlProto',
    '$hlPython',
    '$hlR',
    '$hlRuby',
    '$hlRust',
    '$hlScala',
    '$hlSql',
    '$hlSvelte',
    '$hlSwift',
    '$hlTerraform',
    '$hlToml',
    '$hlVue',
    '$hlWat',
    '$hlWgsl',
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
    const leading = '(call $lexEmitLeadingContinuation)';
    if (!inner.includes(leading)) {
      throw new Error(`${name} has no leading-continuation checkpoint`);
    }
    const live = liveLocalsAtCheckpoint(inner, leading);
    const locals = [...inner.matchAll(/\(local\s+(\$\w+)\s+(\w+)\s*\)/g)];
    // each lexer owns an 8-byte-aligned window of the checkpoint region; the
    // window base lives in $streamRoot so every access is a one-byte offset
    streamStateOffset = (streamStateOffset + 7) & -8;
    const base = streamStateOffset;
    const state = locals
      .filter(([, local]) => live.has(local))
      .map(([, local, type]) => {
        if (type !== 'i32' && type !== 'i64') {
          throw new Error(
            `${name} carries a ${type} local (${local}) across chunks`
          );
        }
        const size = type === 'i64' ? 8 : 4;
        streamStateOffset = (streamStateOffset + size - 1) & -size;
        const at = streamStateOffset - base;
        streamStateOffset += size;
        return { local, type, at };
      });
    if (streamStateOffset > 4000) {
      throw new Error('stream lexer state exceeds reserved memory');
    }
    const load = state
      .map(
        ({ local, type, at }) =>
          `(local.set ${local} (${type}.load offset=${at} (local.get $streamRoot)))`
      )
      .join('\n          ');
    const save = state
      .map(
        ({ local, type, at }) =>
          `(${type}.store offset=${at} (local.get $streamRoot) (local.get ${local}))`
      )
      .join('\n        ');
    let body = inner.replace(
      new RegExp(`^(\\s*\\${name}\\b)`),
      '$1\n    (local $streamRoot i32)'
    );
    body = body.replace(
      leading,
      `${leading}\n    (if (i32.and\n          (global.get $streaming)\n          (i32.eqz (global.get $streamDepth)))\n      (then\n        (local.set $streamRoot (i32.const $mem.streamState+${base}))\n        (global.set $streamDepth (i32.const 1))\n        (if (i32.eqz (global.get $streamReset))\n          (then\n            ${load}))))`
    );
    return `(func${body}\n    (if (local.get $streamRoot)\n      (then\n        ${save}\n        (global.set $streamDepth (i32.const 0)))))`;
  });
  // The live tokenizer captures the whole used checkpoint region per line;
  // publish its length as a named address for src/live.wat.
  code += `\n(const $mem.streamStateUsed ${streamStateOffset})\n`;

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

  // (css-variable-table $Enum <base> <end>) emits [ptr:u16, length:u8]
  // lookup records, one per enum member, at <base>, followed by the blob of
  // kebab-case token suffixes the records point into; the whole must fit
  // below <end>.
  code = replaceForm(code, 'css-variable-table', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+(\d+)\s+(\d+)\s*$/);
    if (m === null)
      throw new Error(`Malformed css-variable-table in ${url.pathname}`);
    const [, enumKey, baseStr, endStr] = m;
    const members = enumMap.get(enumKey);
    if (members === undefined)
      throw new Error(
        `css-variable-table references unknown enum '${enumKey}' in ${url.pathname}`
      );
    const tableBase = Number(baseStr);
    const rangeEnd = Number(endStr);
    const table = new Uint8Array(Object.keys(members).length * 3);
    const stringBase = tableBase + table.length;
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
    if (stringBase + blob.length > rangeEnd) {
      throw new Error(
        `css-variable-table needs ${stringBase + blob.length - tableBase} bytes, range holds ${rangeEnd - tableBase} in ${url.pathname}`
      );
    }
    const data = [...table]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `(data (i32.const ${tableBase}) "${data}")\n  (data (i32.const ${stringBase}) "${blob}")`;
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

  // `(enum-map $Name $Enum <base> <default> (value <v> "member" ...) ...)`
  // emits one byte per enum member at <base>: the member's mapped value, or
  // <default> for members no value lists. A value is a number or an enum
  // member reference such as $Token.operator. `(enum-map.get $Name <expr>)`
  // loads the byte for an enum index - a fixed-cost replacement for a chain
  // of equality tests that maps one enum onto another.
  const enumMaps = new Map<string, number>();
  code = replaceForm(code, 'enum-map', (raw) => {
    const inner = raw.replace(/;;[^\n]*/g, '');
    const head = inner.match(/^\s*(\$\w+)\s+(\$\w+)\s+(\d+)\s+(\S+)/);
    if (head === null) throw new Error(`Malformed enum-map in ${url.pathname}`);
    const [, name, enumKey, baseStr, defaultStr] = head;
    if (enumMaps.has(name)) throw new Error(`Duplicate enum-map ${name}`);
    const members = enumMap.get(enumKey);
    if (members === undefined)
      throw new Error(
        `enum-map '${name}' references unknown enum '${enumKey}' in ${url.pathname}`
      );
    const resolveValue = (v: string): number => resolveEnumValue(v, enumMap);
    const base = Number(baseStr);
    const bytes = new Uint8Array(Object.keys(members).length).fill(
      resolveValue(defaultStr)
    );
    const seen = new Set<string>();
    for (const [, value, list] of inner.matchAll(
      /\(value\s+(\S+)((?:\s+"[\w.]+")+)\s*\)/g
    )) {
      const v = resolveValue(value);
      if (v > 255)
        throw new Error(`enum-map '${name}': value ${v} exceeds a byte`);
      for (const q of list.match(/"[\w.]+"/g) ?? []) {
        const member = JSON.parse(q);
        if (members[member] === undefined || seen.has(member)) {
          throw new Error(
            `enum-map '${name}': '${member}' is not in enum '${enumKey}' or is listed twice in ${url.pathname}`
          );
        }
        seen.add(member);
        bytes[members[member]] = v;
      }
    }
    enumMaps.set(name, base);
    const data = [...bytes]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `;; ${name}: ${bytes.length} entries\n  (data (i32.const ${base}) "${data}")`;
  });

  // (enum-map.get $Name <expr>) -> (i32.load8_u offset=base <expr>)
  code = replaceForm(code, 'enum-map.get', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+([\s\S]+)$/);
    if (m === null)
      throw new Error(`Malformed enum-map.get in ${url.pathname}`);
    const base = enumMaps.get(m[1]);
    if (base === undefined)
      throw new Error(`enum-map '${m[1]}' is undefined in ${url.pathname}`);
    return `(i32.load8_u offset=${base} ${m[2].trim()})`;
  });

  // `(keyword-table $Name <base> <end> (group <value>? "word" ...) ...)`
  // emits a displacement-based perfect hash table for keyword lookup:
  // [buckets] displacement bytes, [slots] u16 descriptors
  // (len<<11 | recOffset+1), [group:u8, word bytes] records (7 zero bytes of
  // slack for wide compares), and, when every group carries a value, a u16
  // value per group. `(keyword-table.get $Name <start> <end>)` looks a word
  // up and returns its 1-based group index, or 0 for a miss;
  // `(keyword-table.value $Name <start> <end>)` returns the group's value, or
  // -1 for a miss (a group whose value is -1 also reads as a miss). The hash mixes the first two bytes, last byte, and length,
  // so words must be 2..31 bytes long. The bucket and slot counts are chosen
  // here: the smallest pair of powers of two that places every word, so a
  // table costs little more than its records.
  const keywordTables = new Map<
    string,
    { base: number; buckets: number; slots: number; values?: number }
  >();
  code = replaceForm(code, 'keyword-table', (raw) => {
    const inner = raw.replace(/;;[^\n]*/g, '');
    const head = inner.match(/^\s*(\$\w+)\s+(\d+)\s+(\d+)\s*\(/);
    if (head === null)
      throw new Error(`Malformed keyword-table in ${url.pathname}`);
    const [, name, baseStr, endStr] = head;
    if (keywordTables.has(name))
      throw new Error(`Duplicate keyword-table ${name}`);
    const base = Number(baseStr);
    const rangeEnd = Number(endStr);
    const words: { word: string; group: number; h: number; desc: number }[] =
      [];
    // a group may carry a value - a number, or an enum member reference with
    // an optional `+bias`, e.g. $Token.keyword.declaration+256 - which the
    // keyword-table.value form returns instead of the group index
    const values: (number | null)[] = [0];
    let group = 0;
    for (const [, value, list] of inner.matchAll(
      /\(group(?:\s+(\$[\w.]+(?:\+\d+)?|-?\d+))?((?:\s+"[\w.@#!-]+")+)\s*\)/g
    )) {
      group += 1;
      if (group > 255)
        throw new Error(`keyword-table ${name} has more than 255 groups`);
      values.push(
        value === undefined ? null : resolveEnumValue(value, enumMap)
      );
      for (const q of list.match(/"[\w.@#!-]+"/g) ?? []) {
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
    if (words.length === 0)
      throw new Error(`keyword-table ${name} has no words`);
    // records blob: group byte + exact word bytes, offsets biased by one
    const records: number[] = [];
    let recOffset = 0;
    for (const w of words) {
      w.h = keywordHash(w.word);
      w.desc = (w.word.length << 11) | (recOffset + 1);
      // Code units equal code points here: words are validated ASCII.
      records.push(w.group, ...w.word.split('').map((c) => c.charCodeAt(0)));
      recOffset += 1 + w.word.length;
    }
    if (recOffset + 1 > 2047)
      throw new Error(
        `keyword-table ${name}: records exceed the 11-bit offset`
      );
    for (const a of words) {
      const twin = words.find((b) => b !== a && b.h === a.h);
      if (twin !== undefined)
        throw new Error(
          `keyword-table ${name}: '${a.word}' and '${twin.word}' share a hash; match one directly`
        );
    }
    // Try every geometry from the cheapest up; the first that places wins.
    let slots = 1;
    while (slots < words.length) slots *= 2;
    const geometries: { buckets: number; slots: number }[] = [];
    for (; slots <= 4096; slots *= 2)
      for (let buckets = 4; buckets <= 256; buckets *= 2)
        geometries.push({ buckets, slots });
    geometries.sort(
      (a, b) => a.buckets + 2 * a.slots - (b.buckets + 2 * b.slots)
    );
    let placed:
      | { buckets: number; slots: number; disp: Uint8Array; table: Uint16Array }
      | undefined;
    for (const g of geometries) {
      const result = placeKeywords(words, g.buckets, g.slots);
      if (result !== undefined) {
        placed = { ...g, ...result };
        break;
      }
    }
    if (placed === undefined)
      throw new Error(`keyword-table ${name}: no geometry places every word`);
    const bytes = [
      ...placed.disp,
      ...[...placed.table].flatMap((v) => [v & 0xff, v >> 8]),
      ...records,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // slack for the lookup's 8-byte-wide tail compare
    ];
    // group values follow as signed 16-bit entries indexed by group (entry 0
    // unused); -1 marks a group the value lookup reports as a miss
    const valued = values.every((v) => v !== null);
    const valuesAt = base + bytes.length;
    if (valued) {
      for (const v of values) {
        if (v < -1 || v > 0x7fff)
          throw new Error(
            `keyword-table ${name}: group value ${v} is out of range`
          );
        bytes.push(v & 0xff, (v >> 8) & 0xff);
      }
    }
    if (base + bytes.length > rangeEnd)
      throw new Error(
        `keyword-table ${name} needs ${bytes.length} bytes, range holds ${rangeEnd - base}`
      );
    keywordTables.set(name, {
      base,
      buckets: placed.buckets,
      slots: placed.slots,
      values: valued ? valuesAt : undefined,
    });
    const data = bytes
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    return `;; ${name}: ${words.length} words, ${placed.buckets} buckets, ${placed.slots} slots, ${bytes.length} bytes\n  (data (i32.const ${base}) "${data}")`;
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

  // (keyword-table.value $Name <start> <end>) -> the value lookup call, which
  // needs the table's u16 value array
  code = replaceForm(code, 'keyword-table.value', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+([\s\S]+)$/);
    if (m === null)
      throw new Error(`Malformed keyword-table.value in ${url.pathname}`);
    const table = keywordTables.get(m[1]);
    if (table?.values === undefined)
      throw new Error(
        `keyword-table '${m[1]}' has no group values in ${url.pathname}`
      );
    return `(call $lexKeywordValue ${m[2].trim()} (i32.const ${table.base}) (i32.const ${table.buckets - 1}) (i32.const ${table.slots - 1}) (i32.const ${table.values}))`;
  });

  // `(byteset.get "bytes" (local.get $x))` tests whether the byte in $x is
  // one of the literal's bytes: a 256-bit membership bitmap replaces the
  // equality ladder a lexer would otherwise spell out, with one load and two
  // shifts however many bytes the set holds. Identical sets share one bitmap
  // in the region at $mem.byteSets, 32 bytes each.
  const byteSets = new Map<string, number>();
  const byteSetBase = constMap.get('$mem.byteSets');
  code = replaceForm(code, 'byteset.get', (inner) => {
    const m = inner.match(
      /^\s*("(?:[^"\\]|\\.)*")\s+(\(local\.get\s+\$\w+\))\s*$/
    );
    if (m === null || byteSetBase === undefined)
      throw new Error(`Malformed byteset.get in ${url.pathname}`);
    const bytes = unescapeWatString(m[1]);
    if (bytes.length === 0)
      throw new Error(`Empty byteset.get in ${url.pathname}`);
    const key = [...new Set(bytes)].sort((a, b) => a - b).join(',');
    let index = byteSets.get(key);
    if (index === undefined) {
      index = byteSets.size;
      if (index >= 64)
        throw new Error(`More than 64 distinct byte sets in ${url.pathname}`);
      byteSets.set(key, index);
    }
    const table = byteSetBase + index * 32;
    return `(i32.and (i32.shr_u (i32.load8_u offset=${table} (i32.shr_u ${m[2]} (i32.const 3))) (i32.and ${m[2]} (i32.const 7))) (i32.const 1))`;
  });
  if (byteSets.size > 0) {
    const bitmap = new Uint8Array(byteSets.size * 32);
    for (const [key, index] of byteSets) {
      for (const b of key.split(',').map(Number)) {
        bitmap[index * 32 + (b >> 3)] |= 1 << (b & 7);
      }
    }
    const data = [...bitmap]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    code = code.replace(
      /^\s*\(\s*module(\s+)/,
      `(module\n  ;; byte-set bitmaps: ${byteSets.size} sets\n  (data (i32.const ${byteSetBase}) "${data}")$1`
    );
  }

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
  };
}

/**
 * Decode a quoted WAT string literal into bytes: `\XX` hex escapes, the
 * named escapes, and plain ASCII. Non-ASCII characters are rejected because
 * the byte sets index by single bytes.
 */
function unescapeWatString(literal: string): number[] {
  const out: number[] = [];
  const named: Record<string, number> = {
    n: 10,
    t: 9,
    r: 13,
    '"': 34,
    "'": 39,
    '\\': 92,
  };
  for (let i = 1; i < literal.length - 1; i++) {
    const c = literal[i];
    if (c !== '\\') {
      const code = c.charCodeAt(0);
      if (code > 0x7f)
        throw new Error(`non-ASCII byte in WAT string ${literal}`);
      out.push(code);
      continue;
    }
    const next = literal[i + 1];
    if (next in named) {
      out.push(named[next]);
      i += 1;
    } else if (/[0-9a-fA-F]{2}/.test(literal.slice(i + 1, i + 3))) {
      out.push(parseInt(literal.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      throw new Error(`bad escape in WAT string ${literal}`);
    }
  }
  return out;
}

/**
 * Resolve a build-time value: a decimal number, or an enum member reference
 * such as `$Token.operator`, optionally biased with `+N`.
 */
function resolveEnumValue(
  text: string,
  enumMap: Map<string, Record<string, number>>
): number {
  if (/^-?\d+$/.test(text)) return Number(text);
  const m = text.match(/^(\$\w+)\.([\w.]+?)(?:\+(\d+))?$/);
  const value = m === null ? undefined : enumMap.get(m[1])?.[m[2]];
  if (value === undefined) throw new Error(`unknown enum value '${text}'`);
  return value + Number(m?.[3] ?? 0);
}

/**
 * The keyword-table hash, the same mix `$lexKeywordLookup` computes at
 * runtime over the first two bytes, the last byte, and the length.
 */
function keywordHash(w: string): number {
  let h =
    (w.charCodeAt(0) |
      (w.charCodeAt(1) << 8) |
      (w.charCodeAt(w.length - 1) << 16) |
      (w.length << 24)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0xe51fac89) >>> 0;
  return (h ^ (h >>> 24)) >>> 0;
}

/**
 * The slot a word probes for a bucket displacement `d`: double hashing, so
 * two words of one bucket that share the base slot still separate for some
 * displacement. Mirrors the runtime lookup.
 */
function keywordSlot(h: number, d: number, slots: number): number {
  return (((h >>> 4) + Math.imul(d, (h >>> 12) | 1)) >>> 0) & (slots - 1);
}

/**
 * Place the words of a keyword table (CHD): words fall into `buckets` by
 * their low hash bits, and each bucket searches for a displacement that
 * puts all of its words into free slots, largest buckets first. Returns the
 * displacement and descriptor tables, or undefined when a bucket finds no
 * displacement in 0..255.
 */
function placeKeywords(
  words: { h: number; desc: number }[],
  buckets: number,
  slots: number
): { disp: Uint8Array; table: Uint16Array } | undefined {
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
      const at = ws.map((w) => keywordSlot(w.h, d, slots));
      if (new Set(at).size === ws.length && at.every((s) => table[s] === 0)) {
        ws.forEach((w, i) => (table[at[i]] = w.desc));
        disp[b] = d;
        placed = true;
      }
    }
    if (!placed) return undefined;
  }
  return { disp, table };
}

/**
 * Split text into its top-level items: parenthesized forms (with their head
 * word) and bare atoms, each with the offsets it spans. Comments and string
 * literals are respected.
 */
function splitTopLevelForms(
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

/** A parsed s-expression: an atom, or a list of nested expressions. */
type Sexpr = string | Sexpr[];

/**
 * Parse folded WAT into nested lists. Line comments, block comments, and
 * string literals are handled; string atoms keep their quotes.
 */
function parseSexpr(src: string): Sexpr[] {
  const root: Sexpr[] = [];
  const stack: Sexpr[][] = [root];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ';' && src[i + 1] === ';') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '(' && src[i + 1] === ';') {
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
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '(') {
      const list: Sexpr[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (c === ')') {
      if (stack.length === 1) throw new Error('unbalanced parenthesis');
      stack.pop();
      i++;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      stack[stack.length - 1].push(src.slice(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < src.length && !/[\s()]/.test(src[j])) j++;
      stack[stack.length - 1].push(src.slice(i, j));
      i = j;
    }
  }
  if (stack.length !== 1) throw new Error('unterminated parenthesis');
  return root;
}

/**
 * Backward liveness over structured wasm control flow. `seq` returns the
 * locals live before a sequence of expressions given the set live after it:
 * local.get adds a name, local.set/tee removes it, branches join the set that
 * is live at their target label, and loops iterate to a fixed point because
 * a back edge carries the loop head's own live-in set.
 */
class LocalLiveness {
  private labels = new Map<string, Set<string>>();

  seq(nodes: Sexpr[], after: Set<string>): Set<string> {
    let live = after;
    for (let i = nodes.length - 1; i >= 0; i--)
      live = this.node(nodes[i], live);
    return live;
  }

  private node(node: Sexpr, after: Set<string>): Set<string> {
    if (typeof node === 'string') return after; // labels, names, immediates
    const [head, ...rest] = node;
    if (typeof head !== 'string') throw new Error('malformed expression');
    switch (head) {
      case 'result':
      case 'param':
      case 'type':
      case 'local':
        return after;
      case 'local.get':
        return new Set(after).add(rest[0] as string);
      case 'local.set':
      case 'local.tee': {
        const before = new Set(after);
        before.delete(rest[0] as string);
        return this.seq(rest.slice(1), before);
      }
      case 'block':
      case 'loop':
      case 'if':
        return this.structured(head, rest, after);
      case 'br':
        return this.seq(rest.slice(1), this.target(rest[0]));
      case 'br_if':
        return this.seq(rest.slice(1), union(after, this.target(rest[0])));
      case 'br_table': {
        let joined = after;
        let i = 0;
        for (
          ;
          typeof rest[i] === 'string' && (rest[i] as string).startsWith('$');
          i++
        ) {
          joined = union(joined, this.target(rest[i]));
        }
        return this.seq(rest.slice(i), joined);
      }
      case 'return':
      case 'unreachable':
        // nothing after an exit is reachable; the caller decides what a
        // return keeps alive
        return this.seq(rest, this.labels.get('return') ?? new Set());
      default:
        return this.seq(rest, after);
    }
  }

  private target(label: Sexpr): Set<string> {
    const live = this.labels.get(label as string);
    if (live === undefined) throw new Error(`unknown label ${String(label)}`);
    return live;
  }

  private structured(
    head: string,
    rest: Sexpr[],
    after: Set<string>
  ): Set<string> {
    let label: string | undefined;
    if (typeof rest[0] === 'string' && rest[0].startsWith('$')) {
      label = rest[0];
      rest = rest.slice(1);
    }
    const body = rest.filter(
      (n) =>
        !(
          Array.isArray(n) &&
          (n[0] === 'result' || n[0] === 'type' || n[0] === 'param')
        )
    );
    let before: Set<string>;
    if (head === 'loop') {
      // a branch to the loop label re-enters the head: iterate until the
      // head's live-in set stops growing
      let entry = new Set<string>();
      for (;;) {
        if (label !== undefined) this.labels.set(label, entry);
        before = this.seq(body, after);
        if (before.size === entry.size) break;
        entry = union(entry, before);
      }
    } else {
      if (label !== undefined) this.labels.set(label, after);
      if (head === 'block') {
        before = this.seq(body, after);
      } else {
        const thenArm = body.find(
          (n) => Array.isArray(n) && n[0] === 'then'
        ) as Sexpr[] | undefined;
        const elseArm = body.find(
          (n) => Array.isArray(n) && n[0] === 'else'
        ) as Sexpr[] | undefined;
        const condition = body.filter((n) => n !== thenArm && n !== elseArm);
        before = this.seq(
          condition,
          union(
            thenArm === undefined ? after : this.seq(thenArm.slice(1), after),
            elseArm === undefined ? after : this.seq(elseArm.slice(1), after)
          )
        );
      }
    }
    if (label !== undefined) this.labels.delete(label);
    return before;
  }
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}

/**
 * The locals of a stream lexer whose values carry across chunk boundaries:
 * those live right after the checkpoint call `marker` in the function body
 * `inner`, i.e. read on some path before they are written. Locals dead at
 * that point are recomputed by the lexer before use, so restoring them is
 * pointless and saving them only bloats the state the live tokenizer interns.
 */
function liveLocalsAtCheckpoint(inner: string, marker: string): Set<string> {
  const body = parseSexpr(inner).filter(Array.isArray);
  const at = body.findIndex(
    (n) => n[0] === 'call' && n[1] === '$lexEmitLeadingContinuation'
  );
  if (at < 0 || !marker.includes('$lexEmitLeadingContinuation')) {
    throw new Error('the checkpoint call must be a top-level statement');
  }
  return new LocalLiveness().seq(body.slice(at + 1), new Set());
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

function listThemeNames(moduleUrl: string): string[] {
  return readdirSync(new URL('../themes/', moduleUrl))
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
}

if (import.meta.main) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  const sourceUrl = new URL('../src/highlights.wat', moduleUrl);
  const { code, enumMap } = transformWat(sourceUrl);
  const wasmBytes = optimizeWasm(wat2wasm(sourceUrl.pathname, code));
  mkdirSync(new URL('../dist/', moduleUrl), { recursive: true });
  writeFileSync(new URL('../dist/highlights.wasm', moduleUrl), wasmBytes);
  writeFileSync(
    new URL('../dist/highlights.wasm.mjs', moduleUrl),
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
  const themesUrl = new URL('../themes/', moduleUrl);
  const themeNames = listThemeNames(moduleUrl);
  const distThemesUrl = new URL('../dist/themes/', moduleUrl);
  mkdirSync(distThemesUrl, { recursive: true });
  const themeDts =
    "import type { Theme } from '../index.js';\n\n" +
    'declare const theme: Theme;\n\n' +
    'export default theme;\n';
  for (const name of themeNames) {
    const json = readFileSync(new URL(`${name}.json`, themesUrl), 'utf-8');
    writeIfChanged(
      new URL(`${name}.js`, distThemesUrl),
      `export default ${json.trim()};\n`
    );
    writeIfChanged(new URL(`${name}.d.ts`, distThemesUrl), themeDts);
  }
  const themesIndexUrl = new URL('../dist/themes.js', moduleUrl);
  const themesIndex = readFileSync(themesIndexUrl, 'utf-8');
  const placeholder = 'const themes = {};';
  if (!themesIndex.includes(placeholder)) {
    throw new Error('dist/themes.js has no themes placeholder');
  }
  writeIfChanged(
    themesIndexUrl,
    themesIndex.replace(
      placeholder,
      'const themes = {\n' +
        themeNames
          .map(
            (name) =>
              `  "${name}": () => import("@pierre/highlights/themes/${name}"),`
          )
          .join('\n') +
        '\n};'
    )
  );
  const pkgUrl = new URL('../package.json', moduleUrl);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf-8'));
  pkg.meta = {
    'highlights.wasm': wasmBytes.length,
    'highlights.wasm.gz': gzipSync(wasmBytes, { level: 9 }).length,
  };
  writeIfChanged(pkgUrl, JSON.stringify(pkg, null, 2) + '\n');
  console.log(
    `✨ Done in ${Math.ceil(performance.now() - start)}ms (wasm: ${pkg.meta['highlights.wasm']} bytes, gzipped: ${pkg.meta['highlights.wasm.gz']} bytes, -O3)`
  );
}
