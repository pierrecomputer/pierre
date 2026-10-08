import binaryen from 'binaryen';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'url';
import wabt from 'wabt';

const { parseWat, readWasm } = await wabt();

/** The expanded module text, resolved enums, and language name lookup. */
export interface TransformedWat {
  code: string;
  enumMap: Map<string, Record<string, number>>;
  languages: Record<string, number>;
}

/**
 * Transform WAT source:
 * - inline local imports
 * - derive language IDs, dispatch, and aliases (`language-table`)
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
  const languages: Record<string, number> = {};
  const bitsetMap = new Map<
    string,
    { base: number; bits: Record<string, number> }
  >();
  const imports: string[] = [];
  const seen = new Set([url.href]);
  // Comments go first, per file, so no pass below can match a form, import,
  // enum, or string literal that only appears in a comment.
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
  let code = flatten(url, content).replace(
    /\(\s*import +".+" +\( *func.+\)/g,
    (i) => {
      imports.push(i);
      return '';
    }
  );

  // Declaration order is the language ABI. Each entry owns its dispatch
  // function and all accepted names; partial lexer fixtures omit this table.
  code = replaceForm(code, 'language-table', (inner) => {
    if (Object.keys(languages).length > 0)
      throw new Error(`Duplicate language-table in ${url.pathname}`);
    const entries = splitTopLevelForms(inner);
    if (entries.length === 0 || entries.length > 256)
      throw new Error(
        `language-table needs 1–256 languages in ${url.pathname}`
      );
    const names: string[] = [];
    const functions: string[] = [];
    for (const [id, entry] of entries.entries()) {
      if (entry.head !== 'language')
        throw new Error(
          `language-table expects language entries in ${url.pathname}`
        );
      const [name, fn, ...aliases] = splitTopLevelForms(entry.text.slice(1, -1))
        .slice(1)
        .map((part) => part.text);
      if (name === undefined || !/^"[a-z][a-z0-9_.-]*"$/.test(name))
        throw new Error(`Invalid canonical language name in ${url.pathname}`);
      if (fn === undefined || !/^\$\w+$/.test(fn))
        throw new Error(
          `Language ${name} needs a lexer function in ${url.pathname}`
        );
      names.push(name);
      functions.push(fn);
      for (const quoted of [name, ...aliases].sort()) {
        if (!/^"[a-z][a-z0-9_.+#-]*"$/.test(quoted))
          throw new Error(
            `Invalid language alias ${quoted} in ${url.pathname}`
          );
        const alias = quoted.slice(1, -1);
        if (Object.hasOwn(languages, alias))
          throw new Error(
            `Duplicate language name ${quoted} in ${url.pathname}`
          );
        languages[alias] = id;
      }
    }
    return (
      `(enum $Language ${names.join(' ')})\n  (table $hlDispatch funcref\n    (elem ${functions.join(' ')}))\n` +
      // partial fixtures without the memory layout carry no name table
      (/\(const\s+\$mem\.languageNames\b/.test(code)
        ? languageNamesData(languages, names)
        : '')
    );
  });

  code = code.replace(
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

  // `(byte-switch (local.get $c) (case <byte>... body...) ...)` uses br_table
  // to select a case. Each case lists string or numeric byte constants,
  // then its body. A body without a branch or return continues after the
  // switch. Cases form nested blocks in source order inside a default block.
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

  // Save top-level lexer locals between streaming calls.
  // Nested lexers have nonzero depth and remain bounded calls. TypeScript
  // uses its own state machine. Save only locals read before their next
  // write at the checkpoint. See liveLocalsAtCheckpoint.
  const lexers = new Set([
    '$hlAsm',
    '$hlAstro',
    '$hlBash',
    '$hlBatch',
    '$hlC',
    '$hlC3',
    '$hlClojure',
    '$hlCmake',
    '$hlCppImpl',
    '$hlCsharp',
    '$hlCssImpl',
    '$hlDart',
    '$hlDiff',
    '$hlDockerfile',
    '$hlElixir',
    '$hlElm',
    '$hlErlang',
    '$hlFortranImpl',
    '$hlFsharp',
    '$hlGdresource',
    '$hlGdscript',
    '$hlGleam',
    '$hlGlslImpl',
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
    '$hlSolidity',
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
    if (name === undefined || !lexers.has(name)) return `(func${inner})`;
    if (inner.includes('(return')) {
      throw new Error(`${name} cannot checkpoint locals with an early return`);
    }
    const leading = '(call $lexEmitLeadingContinuation)';
    if (!inner.includes(leading)) {
      throw new Error(`${name} has no leading-continuation checkpoint`);
    }
    const live = liveLocalsAtCheckpoint(inner);
    const locals = [...inner.matchAll(/\(local\s+(\$\w+)\s+(\w+)\s*\)/g)];
    // Each lexer has an 8-byte-aligned checkpoint window.
    // Keep its base in mutable global $streamWindow. Binaryen folds a constant
    // local into three-byte absolute addresses. A global base uses a two-byte
    // global.get and one-byte offsets. $streamRoot identifies the owning lexer.
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
    const load = state
      .map(
        ({ local, type, at }) =>
          `(local.set ${local} (${type}.load offset=${at} (global.get $streamWindow)))`
      )
      .join('\n          ');
    const save = state
      .map(
        ({ local, type, at }) =>
          `(${type}.store offset=${at} (global.get $streamWindow) (local.get ${local}))`
      )
      .join('\n        ');
    let body = inner.replace(
      new RegExp(`^(\\s*\\${name}\\b(?:\\s*\\((?:param|result)\\b[^)]*\\))*)`),
      '$1\n    (local $streamRoot i32)'
    );
    body = body.replace(
      leading,
      `${leading}\n    (if (i32.and\n          (global.get $streaming)\n          (i32.eqz (global.get $streamDepth)))\n      (then\n        (global.set $streamWindow (i32.const $mem.streamState+${base}))\n        (global.set $streamDepth (local.tee $streamRoot (i32.const 1)))\n        (if (i32.eqz (global.get $streamReset))\n          (then\n            ${load}))))`
    );
    return `(func${body}\n    (if (local.get $streamRoot)\n      (then\n        ${save}\n        (global.set $streamDepth (i32.const 0)))))`;
  });
  // The live tokenizer captures the whole used checkpoint region per line;
  // publish its length as a named address for src/live.wat.
  code += `\n(const $mem.streamStateUsed ${streamStateOffset})\n`;

  // Nested lexers cannot yield: their callers' locals are not saved here.
  const liveModule = code.includes('(export "liveRun")');
  code = replaceForm(code, 'func', (inner) => {
    const name = inner.match(/^\s*(\$\w+)/)?.[1];
    if (
      !liveModule ||
      name === undefined ||
      (!lexers.has(name) && name !== '$hlEcmaImpl' && name !== '$hlAngularHtml')
    )
      return `(func${inner})`;
    const forms = splitTopLevelForms(inner);
    const loopBlock = forms.find(
      (form) =>
        form.head === 'block' &&
        splitTopLevelForms(form.text.slice(1, -1)).some(
          (child) => child.head === 'loop'
        )
    );
    if (loopBlock === undefined)
      return `(func${inner.replace(
        '(call $lexEmitLeadingContinuation)',
        '(global.set $liveEntering (i32.const 0))\n(call $lexEmitLeadingContinuation)'
      )})`;
    const first = forms.find(
      (form) =>
        form.head !== '' && !['param', 'result', 'local'].includes(form.head)
    )!;
    const carried = new LocalLiveness().seq(
      parseSexpr(inner.slice(loopBlock.start)),
      new Set()
    );
    let offset = 0;
    const locals = [
      ...inner.matchAll(/\((?:local|param)\s+(\$\w+)\s+(\w+)\s*\)/g),
    ]
      .filter(([, local]) => carried.has(local))
      .map(([, local, type]) => {
        if (type !== 'i32' && type !== 'i64')
          throw new Error(`${name} cannot suspend a ${type} local`);
        const size = type === 'i64' ? 8 : 4;
        offset = (offset + size - 1) & -size;
        const at = offset;
        offset += size;
        return { local, type, at };
      });
    if (offset > 512) throw new Error(`${name} exceeds live lexer locals`);
    const load = locals
      .map(
        ({ local, type, at }) =>
          `(local.set ${local} (${type}.load offset=${at} (i32.const $mem.liveLocals)))`
      )
      .join('\n');
    const save = locals
      .map(
        ({ local, type, at }) =>
          `(${type}.store offset=${at} (i32.const $mem.liveLocals) (local.get ${local}))`
      )
      .join('\n');
    const block = loopBlock.text.replace(
      /\(loop\s+\$\w+/,
      (loop) => `${loop}
      (if (i32.ge_u (global.get $ptr) (global.get $liveLimit))
        (then
          (if (local.get $liveRoot)
            (then
              ${save}
              (global.set $liveSuspended (i32.const 1))
              (return ${inner.includes('(result i32)') ? '(i32.const 0)' : ''})))))`
    );
    return `(func${inner.slice(0, first.start)}
      (local $liveRoot i32)
      (local.set $liveRoot (global.get $liveEntering))
      (global.set $liveEntering (i32.const 0))
      (if (global.get $liveSuspended)
        (then
          (global.set $liveSuspended (i32.const 0))
          ${load})
        (else ${inner.slice(first.start, loopBlock.start)}))
      ${block}${inner.slice(loopBlock.end)})`;
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
  // the checkpoint region ends at the next named address above its base
  const streamStateBase = constMap.get('$mem.streamState') ?? 0;
  const streamStateEnd = Math.min(
    ...[...constMap.values()].filter((v) => v > streamStateBase)
  );
  if (streamStateOffset > streamStateEnd - streamStateBase) {
    throw new Error('stream lexer state exceeds reserved memory');
  }
  code = code.replace(/(\$[\w.]+)([+-]\d+)?/g, (all, name, bias) => {
    const value = constMap.get(name);
    return value !== undefined ? String(value + Number(bias ?? 0)) : all;
  });
  const stray = code.match(/\$mem\.[\w.]+/);
  if (stray !== null)
    throw new Error(`Const '${stray[0]}' is undefined in ${url.pathname}`);

  // (css-variable-table $Enum <base> <end>) writes [ptr:u16, length:u8]
  // records at <base>, one per enum member. Kebab-case token suffixes
  // follow the records. All data must fit below <end>.
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
  // writes one byte per enum member at <base>. Unlisted members use <default>.
  // Values are numbers or enum references, such as $Token.operator.
  // `(enum-map.get $Name <expr>)` loads the byte for an enum index.
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
  // builds a perfect hash table. Layout: displacement bytes per bucket,
  // then 3-byte descriptors (len<<19 | group<<13 | word offset).
  // If every group has a value, u16 group values follow the descriptors.
  // Words share the `keyword-pool`, including repeated words and substrings.
  //
  // `(keyword-table.get $Name <start> <end>)` returns the 1-based group
  // index, or 0 if absent. `keyword-table.value` returns the group's value,
  // or -1 if absent. A declared value of -1 also means absent.
  // The hash uses the first two bytes, last byte, and length. Words must
  // be 2..31 bytes long. Tables support at most 63 groups.
  //
  // A multiply and shift reduce the hash to any slot count.
  // Choose the smallest bucket/slot layout that places all words.
  // Assign addresses after all tables and the shared pool are known.
  interface PendingKeywordTable {
    name: string;
    base: number;
    rangeEnd: number;
    words: { word: string; group: number; h: number }[];
    values: (number | null)[];
  }
  const pendingTables: PendingKeywordTable[] = [];
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
    if (pendingTables.some((t) => t.name === name))
      throw new Error(`Duplicate keyword-table ${name}`);
    const words: PendingKeywordTable['words'] = [];
    // a group may carry a value - a number, or an enum member reference with
    // an optional `+bias`, e.g. $Token.keyword.declaration+256 - which the
    // keyword-table.value form returns instead of the group index
    const values: (number | null)[] = [0];
    let group = 0;
    for (const [, value, list] of inner.matchAll(
      /\(group(?:\s+(\$[\w.-]+(?:\+\d+)?|-?\d+))?((?:\s+"[\w.$@#!-]+")+)\s*\)/g
    )) {
      group += 1;
      if (group > 63)
        throw new Error(`keyword-table ${name} has more than 63 groups`);
      values.push(
        value === undefined ? null : resolveEnumValue(value, enumMap)
      );
      for (const q of list.match(/"[\w.$@#!-]+"/g) ?? []) {
        const word = JSON.parse(q);
        if (word.length < 2 || word.length > 31)
          throw new Error(
            `keyword-table ${name}: '${word}' must be 2..31 bytes`
          );
        if (words.some((w) => w.word === word))
          throw new Error(`keyword-table ${name}: duplicate word '${word}'`);
        words.push({ word, group, h: keywordHash(word) });
      }
    }
    if (words.length === 0)
      throw new Error(`keyword-table ${name} has no words`);
    for (const a of words) {
      const twin = words.find((b) => b !== a && b.h === a.h);
      if (twin !== undefined)
        throw new Error(
          `keyword-table ${name}: '${a.word}' and '${twin.word}' share a hash; match one directly`
        );
    }
    pendingTables.push({
      name,
      base: Number(baseStr),
      rangeEnd: Number(endStr),
      words,
      values,
    });
    return `@@keyword-table ${name}@@`;
  });

  // `(keyword-pool <base> <end>)` reserves shared keyword bytes.
  // packKeywordPool combines the words into one string. The 13-bit descriptor
  // offset limits it to 8191 bytes. Declare it once beside $lexKeywordLookup.
  let keywordPool: { base: number; rangeEnd: number } | undefined;
  code = replaceForm(code, 'keyword-pool', (inner) => {
    const m = inner.match(/^\s*(\d+)\s+(\d+)\s*$/);
    if (m === null)
      throw new Error(`Malformed keyword-pool in ${url.pathname}`);
    if (keywordPool !== undefined)
      throw new Error(`Duplicate keyword-pool in ${url.pathname}`);
    keywordPool = { base: Number(m[1]), rangeEnd: Number(m[2]) };
    return '@@keyword-pool@@';
  });
  if (pendingTables.length > 0) {
    if (keywordPool === undefined)
      throw new Error(`keyword-table needs a keyword-pool in ${url.pathname}`);
    const pool = packKeywordPool(
      pendingTables.flatMap((t) => t.words.map((w) => w.word))
    );
    const poolCapacity = Math.min(
      8191,
      keywordPool.rangeEnd - keywordPool.base
    );
    if (pool.length > poolCapacity)
      throw new Error(
        `keyword-pool needs ${pool.length} bytes, range holds ${poolCapacity}`
      );
    for (const table of pendingTables) {
      const placed = placeKeywordTable(table.words);
      if (placed === undefined)
        throw new Error(
          `keyword-table ${table.name}: no geometry places every word`
        );
      const bytes = [...placed.disp];
      for (const index of placed.at) {
        if (index < 0) {
          bytes.push(0, 0, 0);
          continue;
        }
        const w = table.words[index];
        const desc =
          (w.word.length << 19) | (w.group << 13) | pool.indexOf(w.word);
        bytes.push(desc & 0xff, (desc >> 8) & 0xff, desc >> 16);
      }
      // group values follow as signed 16-bit entries indexed by group (entry
      // 0 unused); -1 marks a group the value lookup reports as a miss
      const groupValues = table.values.every((v): v is number => v !== null)
        ? table.values
        : undefined;
      const valuesAt = table.base + bytes.length;
      if (groupValues !== undefined) {
        for (const v of groupValues) {
          if (v < -1 || v > 0x7fff)
            throw new Error(
              `keyword-table ${table.name}: group value ${v} is out of range`
            );
          bytes.push(v & 0xff, (v >> 8) & 0xff);
        }
      }
      if (table.base + bytes.length > table.rangeEnd)
        throw new Error(
          `keyword-table ${table.name} needs ${bytes.length} bytes, range holds ${table.rangeEnd - table.base}`
        );
      keywordTables.set(table.name, {
        base: table.base,
        buckets: placed.buckets,
        slots: placed.slots,
        values: groupValues !== undefined ? valuesAt : undefined,
      });
      const data = bytes
        .map((b) => '\\' + b.toString(16).padStart(2, '0'))
        .join('');
      // a replacer function keeps `$` in names out of the pattern syntax
      code = code.replace(
        `@@keyword-table ${table.name}@@`,
        () =>
          `;; ${table.name}: ${table.words.length} words, ${placed.buckets} buckets, ${placed.slots} slots, ${bytes.length} bytes\n  (data (i32.const ${table.base}) "${data}")`
      );
    }
    const data = pool
      .split('')
      .map((c) => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    const poolBase = keywordPool.base;
    code = code.replace(
      '@@keyword-pool@@',
      () =>
        `;; keyword pool: ${pool.length} bytes\n  (data (i32.const ${poolBase}) "${data}")`
    );
  } else {
    code = code.replace('@@keyword-pool@@', '');
  }

  // (keyword-table.get $Name <start> <end>) -> the shared lookup call with the
  // table's base, bucket mask, and slot count filled in
  code = replaceForm(code, 'keyword-table.get', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+([\s\S]+)$/);
    if (m === null)
      throw new Error(`Malformed keyword-table.get in ${url.pathname}`);
    const table = keywordTables.get(m[1]);
    if (table === undefined)
      throw new Error(
        `keyword-table '${m[1]}' is undefined in ${url.pathname}`
      );
    return `(call $lexKeywordLookup ${m[2].trim()} (i32.const ${table.base}) (i32.const ${table.buckets - 1}) (i32.const ${table.slots}))`;
  });

  // (keyword-table.value $Name <start> <end>) -> the value lookup call; the
  // table must declare a value for every group
  code = replaceForm(code, 'keyword-table.value', (inner) => {
    const m = inner.match(/^\s*(\$\w+)\s+([\s\S]+)$/);
    if (m === null)
      throw new Error(`Malformed keyword-table.value in ${url.pathname}`);
    const table = keywordTables.get(m[1]);
    if (table?.values === undefined)
      throw new Error(
        `keyword-table '${m[1]}' has no group values in ${url.pathname}`
      );
    return `(call $lexKeywordValue ${m[2].trim()} (i32.const ${table.base}) (i32.const ${table.buckets - 1}) (i32.const ${table.slots}))`;
  });

  // `(byteset.get "bytes" (local.get $x))` tests whether a set contains $x.
  // Identical sets share one bit. Eight sets share a 256-byte table at
  // $mem.byteSets: one byte per input byte, one bit per set.
  // For branch conditions, use `load & bit` (see branchOperands).
  // Other expressions need an exact 0/1 result for boolean arithmetic.
  const byteSets = new Map<string, number>();
  const byteSetBase = constMap.get('$mem.byteSets');
  // the region ends at the next named address, 32 bytes (256 bits) per set
  const byteSetCap =
    byteSetBase === undefined
      ? 0
      : (Math.min(...[...constMap.values()].filter((v) => v > byteSetBase)) -
          byteSetBase) >>
        5;
  const byteSetBranches = branchOperands(code, 'byteset.get');
  code = replaceForm(code, 'byteset.get', (inner, at) => {
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
      if (index >= byteSetCap)
        throw new Error(
          `More than ${byteSetCap} distinct byte sets in ${url.pathname}`
        );
      byteSets.set(key, index);
    }
    const bit = index & 7;
    const load = `(i32.load8_u offset=${byteSetBase + (index >> 3) * 256} ${m[2]})`;
    if (byteSetBranches.has(at))
      return `(i32.and ${load} (i32.const ${1 << bit}))`;
    if (bit === 0) return `(i32.and ${load} (i32.const 1))`;
    if (bit === 7) return `(i32.shr_u ${load} (i32.const 7))`;
    return `(i32.and (i32.shr_u ${load} (i32.const ${bit})) (i32.const 1))`;
  });
  if (byteSets.size > 0) {
    const tables = new Uint8Array(((byteSets.size + 7) >> 3) * 256);
    for (const [key, index] of byteSets) {
      for (const b of key.split(',').map(Number)) {
        tables[(index >> 3) * 256 + b] |= 1 << (index & 7);
      }
    }
    const data = [...tables]
      .map((b) => '\\' + b.toString(16).padStart(2, '0'))
      .join('');
    code = code.replace(
      /^\s*\(\s*module(\s+)/,
      `(module\n  ;; byte-set tables: ${byteSets.size} sets\n  (data (i32.const ${byteSetBase}) "${data}")$1`
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
      /(\(\s*)enum\.get\s+(\$\w+)\.([\w.-]+)/g,
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
  code = wrapCompoundNegations(code);
  checkDataSegments(code, url.pathname);
  if (imports.length > 0) {
    code = code.replace(
      /^\s*\(\s*module(\s+)/,
      `(module\n${imports.map((i) => '  ' + i).join('\n')}$1`
    );
  }
  code = markSimdReachers(code);
  return {
    code,
    enumMap,
    languages,
  };
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
 * Decode a WAT string into bytes: hex escapes, named escapes, and ASCII.
 * Reject non-ASCII characters because byte sets index individual bytes.
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
 * Resolve a decimal number or enum reference such as `$Token.operator`,
 * with an optional `+N` offset.
 */
function resolveEnumValue(
  text: string,
  enumMap: Map<string, Record<string, number>>
): number {
  if (/^-?\d+$/.test(text)) return Number(text);
  const m = text.match(/^(\$\w+)\.([\w.-]+?)(?:\+(\d+))?$/);
  const value = m === null ? undefined : enumMap.get(m[1])?.[m[2]];
  if (value === undefined) throw new Error(`unknown enum value '${text}'`);
  return value + Number(m?.[3] ?? 0);
}

/**
 * Hash the first two bytes, last byte, and word length.
 * Must match $lexKeywordLookup in src/common.wat.
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
 * Compute a word's slot from its hash and bucket displacement `d`.
 * Add `d` times an odd second hash, rotate, then multiply and shift
 * to reduce to `slots`. This supports any slot count and separates
 * words with the same base slot. Must match the runtime lookup.
 */
function keywordSlot(h: number, d: number, slots: number): number {
  const x = (h + Math.imul(d, (h >>> 12) | 1)) >>> 0;
  const rotated = ((x << 16) | (x >>> 16)) >>> 0;
  // exact: the product stays below 2^53
  return Math.floor((rotated * slots) / 4294967296);
}

/**
 * Place words with a compress, hash, and displace (CHD) table.
 * Low hash bits select each bucket. Starting with the largest bucket,
 * find a displacement that puts all its words in free slots.
 * Return displacement bytes and word indices (-1 for empty slots).
 * Return undefined if any bucket has no valid displacement in 0..255.
 */
function placeKeywords(
  words: { h: number }[],
  buckets: number,
  slots: number
): { disp: Uint8Array; at: Int32Array } | undefined {
  const byBucket = new Map<number, number[]>();
  words.forEach((w, i) => {
    const b = w.h & (buckets - 1);
    let bucket = byBucket.get(b);
    if (bucket === undefined) byBucket.set(b, (bucket = []));
    bucket.push(i);
  });
  const disp = new Uint8Array(buckets);
  const at = new Int32Array(slots).fill(-1);
  const order = [...byBucket.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );
  for (const [b, ws] of order) {
    let placed = false;
    for (let d = 0; d < 256 && !placed; d++) {
      const s = ws.map((i) => keywordSlot(words[i].h, d, slots));
      if (new Set(s).size === ws.length && s.every((x) => at[x] === -1)) {
        ws.forEach((i, k) => (at[s[k]] = i));
        disp[b] = d;
        placed = true;
      }
    }
    if (!placed) return undefined;
  }
  return { disp, at };
}

/**
 * Choose the smallest table that places every word.
 * Try slot counts from the word count upward and power-of-two bucket
 * counts. Cost is one byte per bucket plus three per slot.
 * Use the first valid layout in cost order.
 */
function placeKeywordTable(
  words: { h: number }[]
):
  | { buckets: number; slots: number; disp: Uint8Array; at: Int32Array }
  | undefined {
  const n = words.length;
  const step = Math.max(1, Math.floor(n / 64));
  const geometries: { buckets: number; slots: number }[] = [];
  for (let slots = n; slots <= 2 * n + 4; slots += step)
    for (let buckets = 4; buckets <= 512; buckets *= 2)
      geometries.push({ buckets, slots });
  geometries.sort(
    (a, b) => a.buckets + 3 * a.slots - (b.buckets + 3 * b.slots)
  );
  for (const g of geometries) {
    const placed = placeKeywords(words, g.buckets, g.slots);
    if (placed !== undefined) return { ...g, ...placed };
  }
  return undefined;
}

/**
 * Pack distinct keywords into one string. Reuse words contained in others.
 * Process longer words first and choose the largest overlap between
 * the next word's start and the pool's end. Descriptors use each word's
 * first occurrence.
 */
function packKeywordPool(all: string[]): string {
  const distinct = [...new Set(all)].sort((a, b) =>
    a.length === b.length ? (a < b ? -1 : 1) : b.length - a.length
  );
  const words = distinct.filter(
    (w) => !distinct.some((o) => o !== w && o.includes(w))
  );
  let pool = words.shift() ?? '';
  while (words.length > 0) {
    let best = 0;
    let overlap = 0;
    for (const [i, w] of words.entries()) {
      for (let n = Math.min(pool.length, w.length - 1); n > overlap; n--) {
        if (pool.endsWith(w.slice(0, n))) {
          best = i;
          overlap = n;
          break;
        }
      }
    }
    pool += words.splice(best, 1)[0].slice(overlap);
  }
  return pool;
}

/**
 * Build the name table searched by $languageByName in src/languages.wat.
 * Store u16 offsets for lengths 0..19, then group names by length.
 * Group L spans offsets [L, L+1). Each record holds a language ID byte
 * and lowercase name. Put canonical names before aliases because fences
 * use them most often and searches are linear within each group.
 */
function languageNamesData(
  languages: Record<string, number>,
  canonical: string[]
): string {
  const isCanonical = new Set(canonical.map((quoted) => quoted.slice(1, -1)));
  const maxLength = 18; // $languageByName rejects longer words
  // plain text's names resolve to id 0, the same as no match
  const names = Object.keys(languages)
    .filter((name) => languages[name] !== 0)
    .sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      const rank = Number(isCanonical.has(b)) - Number(isCanonical.has(a));
      if (rank !== 0) return rank;
      return a < b ? -1 : 1;
    });
  const long = names.find((name) => name.length > maxLength);
  if (long !== undefined)
    throw new Error(`Language name "${long}" exceeds ${maxLength} bytes`);
  const offsets: number[] = [];
  const records: number[] = [];
  for (let length = 0; length <= maxLength + 1; length++) {
    offsets.push(2 * (maxLength + 2) + records.length);
    for (const name of names.filter((n) => n.length === length))
      records.push(languages[name], ...Buffer.from(name, 'latin1'));
  }
  const bytes = [...offsets.flatMap((o) => [o & 255, o >> 8]), ...records];
  const text = bytes.map((b) => '\\' + b.toString(16).padStart(2, '0'));
  return `  (data (i32.const $mem.languageNames) "${text.join('')}")`;
}

/**
 * Split text into top-level forms and bare atoms with their source offsets.
 * Include each form's head word. Respect comments and string literals.
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
 * Parse folded WAT into nested lists. Handle line and block comments.
 * Keep quotes on string atoms.
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
 * Find locals that are read before their next write.
 * `seq` walks expressions backward from the set needed after them.
 * local.get adds a name. local.set/tee removes it. Branches include
 * locals needed at their target. Repeat loops until the set stops changing.
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
          typeof rest[i] === 'string' && /^[$\d]/.test(rest[i] as string);
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
    if (typeof label !== 'string' || /^\d/.test(label)) {
      throw new Error(
        `label ${String(label)} must be a name: stream lexers cannot branch by index`
      );
    }
    const live = this.labels.get(label);
    if (live === undefined) throw new Error(`unknown label ${label}`);
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
    // a nested block may reuse an outer label; restore the outer binding on
    // the way out so later references (earlier in source) still resolve
    const outer = label === undefined ? undefined : this.labels.get(label);
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
    if (label !== undefined) {
      if (outer === undefined) this.labels.delete(label);
      else this.labels.set(label, outer);
    }
    return before;
  }
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set(a);
  for (const x of b) out.add(x);
  return out;
}

/**
 * Find locals read before their next write after $lexEmitLeadingContinuation
 * in `inner`. Save these across chunks. Other locals are recomputed before
 * use, so saving them would only increase the live tokenizer's state size.
 */
function liveLocalsAtCheckpoint(inner: string): Set<string> {
  const body = parseSexpr(inner).filter(Array.isArray);
  const at = body.findIndex(
    (n) => n[0] === 'call' && n[1] === '$lexEmitLeadingContinuation'
  );
  if (at < 0) {
    throw new Error('the checkpoint call must be a top-level statement');
  }
  return new LocalLiveness().seq(body.slice(at + 1), new Set());
}

/**
 * Find forms whose values only decide a branch: `if` conditions, the last
 * operand of `br_if`, and operands of `i32.eqz`.
 * These can use any nonzero true value instead of exactly 1.
 * Return source offsets matching replaceForm for the same `code`.
 */
function branchOperands(code: string, head: string): Set<number> {
  const found = new Set<number>();
  // each open form: its head, and the offset and head of its last child
  const stack: { head: string; lastAt: number; lastHead: string }[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '"') {
      for (i++; i < code.length && code[i] !== '"'; i++) {
        if (code[i] === '\\') i++;
      }
    } else if (c === ';' && code[i + 1] === ';') {
      while (i < code.length && code[i] !== '\n') i++;
    } else if (c === '(') {
      const name = /^\(\s*([^\s()]+)/.exec(code.slice(i, i + 64))?.[1] ?? '';
      const parent = stack[stack.length - 1];
      if (parent !== undefined) {
        parent.lastAt = i;
        parent.lastHead = name;
        if (
          name === head &&
          (parent.head === 'if' || parent.head === 'i32.eqz')
        )
          found.add(i);
      }
      stack.push({ head: name, lastAt: -1, lastHead: '' });
    } else if (c === ')') {
      const frame = stack.pop();
      if (frame?.head === 'br_if' && frame.lastHead === head)
        found.add(frame.lastAt);
    }
  }
  return found;
}

/**
 * Replace each `(head ...)` form with `fn(innerText, offset)`, where offset
 * is the form's start in `code`.
 * Skip quoted strings when matching, and preserve nested forms and operands.
 */
function replaceForm(
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
function wrapCompoundNegations(code: string): string {
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
function markSimdReachers(code: string): string {
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
 * Optimize with Binaryen at `-O3 --shrink-level=1` and emit Stack IR.
 * Three passes reduce the module size. A fourth gives no further reduction.
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
  // Binaryen turns byte splats into 18-byte vector constants.
  // After optimization, restore the 4-5-byte scalar-and-splat form.
  // Also restore compound-negation rewrites and SIMD markers.
  // All three transformations operate on folded WAT.
  const compact = readWasm(wasmBytes, { readDebugNames: false });
  try {
    const code = compact.toText({ foldExprs: true, inlineExport: false });
    return wat2wasm(
      'highlights.wat',
      markSimdReachers(
        wrapCompoundNegations(
          compactMaskedCompares(
            replaceForm(code, 'v128.const', (inner) => {
              const byte = inner.match(
                /^\s*i32x4 (0x([0-9a-f]{2})\2\2\2) \1 \1 \1\s*$/
              )?.[2];
              return byte === undefined
                ? `(v128.const${inner})`
                : `(i8x16.splat (i32.const ${(parseInt(byte, 16) << 24) >> 24}))`;
            })
          )
        )
      )
    );
  } finally {
    compact.destroy();
  }
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
  if (names.length > tokenSlotLimit) {
    throw new Error(
      `$Token has ${names.length} members; the emitter span cache holds ${tokenSlotLimit} (see $mem.emitterSpanCache in src/memory.wat, the 384-byte theme table, and lib/highlighter.ts themeBytes)`
    );
  }
  return names;
}

// Maximum token count supported by the fixed memory regions.
// The span cache holds 73 slots of 66 bytes. Theme tables and SIMD
// comparisons cover 384 bytes (76 five-byte records). Packed live records
// use one byte for the ID. Resize these regions before increasing the limit.
const tokenSlotLimit = 73;

/** Generate the checked-in language lookup and derive Lang from its keys. */
export function generateLanguages(languages: Record<string, number>): string {
  if (Object.keys(languages).length === 0)
    throw new Error('no language-table found');
  return (
    '// generated by scripts/build.ts - do not edit\n' +
    'const languages = {\n' +
    Object.entries(languages)
      .map(
        ([name, id]) => `  ${/^\w+$/.test(name) ? name : `'${name}'`}: ${id},`
      )
      .join('\n') +
    '\n} as const;\n\n' +
    '/** A language name or alias supported by a built-in lexer. */\n' +
    'export type Lang = keyof typeof languages;\n\n' +
    'export default languages;\n'
  );
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

// Emit the wasm, theme modules, and lazy loader before tsdown compiles the
// glue so it picks up the regenerated token and language tables.
if (import.meta.main) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  const sourceUrl = new URL('../src/highlights.wat', moduleUrl);
  const { code, enumMap, languages } = transformWat(sourceUrl);
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
  writeIfChanged(
    new URL('../lib/languages.ts', moduleUrl),
    generateLanguages(languages)
  );
  const themesUrl = new URL('../themes/', moduleUrl);
  const themeNames = readdirSync(themesUrl)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .sort();
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
  writeIfChanged(
    new URL('loader.js', distThemesUrl),
    'export const themes = {\n' +
      themeNames
        .map(
          (name) =>
            `  "${name}": () => import("@pierre/highlights/themes/${name}"),`
        )
        .join('\n') +
      '\n};\n'
  );
  writeIfChanged(
    new URL('loader.d.ts', distThemesUrl),
    "import type { Theme } from '../index.js';\n\n" +
      'export declare const themes: Record<string, () => Promise<{ default: Theme }>>;\n'
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
