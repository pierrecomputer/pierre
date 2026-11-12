import type { TransformedWat } from '@pierre/wat-tools';
import {
  flattenWat,
  listTokenTypes,
  optimizeWasm as optimize,
  splitTopLevelForms,
  transformWat,
  wat2wasm,
} from '@pierre/wat-tools';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { isMainThread, Worker, workerData } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';

export {
  listTokenTypes,
  transformWat,
  wasmToText,
  wat2wasm,
} from '@pierre/wat-tools';
export type { TransformedWat } from '@pierre/wat-tools';

/** Keep wider inlining while reducing the all-language browser download. */
export function optimizeWasm(wasmBytes: Uint8Array): Uint8Array {
  return optimize(wasmBytes, {
    filename: 'highlights.wat',
    shrinkLevel: 1,
    flexibleInlineMaxSize: 60,
    oneCallerInlineMaxSize: 200,
  });
}

/** Fold build-time branches before tracing lexer dependencies. */
function foldLexerForms(source: string): string {
  const output: string[] = [];
  for (const form of splitTopLevelForms(source)) {
    if (!form.text.startsWith('(')) {
      output.push(form.text);
      continue;
    }
    const body = foldLexerForms(form.text.slice(1, -1));
    const parts = splitTopLevelForms(body).map((part) => part.text);
    const constant = (text: string | undefined): number | undefined => {
      const value = text?.match(/^\(i32\.const (-?\d+)\)$/)?.[1];
      return value === undefined ? undefined : Number(value);
    };
    let text = `(${body})`;
    const left = constant(parts[1]);
    const right = constant(parts[2]);
    if (parts[0] === 'if' && left !== undefined) {
      const branch = parts.find((part) =>
        part.startsWith(left === 0 ? '(else ' : '(then ')
      );
      text =
        branch === undefined ? '' : branch.slice(branch.indexOf(' ') + 1, -1);
    } else if (parts[0] === 'i32.eqz' && left !== undefined) {
      text = `(i32.const ${Number(left === 0)})`;
    } else if (parts[0] === 'i32.and' && (left === 0 || right === 0)) {
      text = '(i32.const 0)';
    } else if (
      parts[0] === 'i32.or' &&
      left !== undefined &&
      right !== undefined
    ) {
      text = `(i32.const ${left | right})`;
    } else if (parts[0] === 'i32.or' && (left === 0 || right === 0)) {
      text = left === 0 ? parts[2] : parts[1];
    } else if (parts[0] === 'select' && constant(parts[3]) !== undefined) {
      text = constant(parts[3]) === 0 ? parts[2] : parts[1];
    }
    output.push(text);
    if (
      ['func', 'block', 'loop', 'then', 'else'].includes(output[0]) &&
      splitTopLevelForms(text).some(
        (part) => part.head === 'return' || part.head === 'unreachable'
      )
    )
      break;
  }
  return output.filter(Boolean).join(' ');
}

export function transformLexer(
  names?: readonly string[],
  regions = false
): TransformedWat {
  const url = new URL('../src/lexer.wat', import.meta.url);
  const tools = new URL(
    '.',
    import.meta.resolve('@pierre/wat-tools/records.wat')
  );
  const overrides = new Map([
    [
      new URL('../src/emitter.wat', import.meta.url).href,
      new URL('records.wat', tools),
    ],
    [
      new URL('../src/token.wat', import.meta.url).href,
      new URL('token.wat', tools),
    ],
    [
      new URL('../src/memory.wat', import.meta.url).href,
      new URL('memory.wat', tools),
    ],
  ]);
  const flattened = flattenWat(url, readFileSync(url, 'utf-8'), { overrides });
  const selected = names === undefined ? undefined : new Set(names);
  const forms = splitTopLevelForms(
    flattened.code
      .replace(/^\s*\(module/, '')
      .trimEnd()
      .slice(0, -1)
  );
  // WARNING: A pattern that no longer matches the WAT source would leave dead
  // lexers in every standalone module, with no other sign.
  const remove = (text: string, pattern: RegExp): string => {
    const pruned = text.replace(pattern, '');
    if (pruned === text) throw new Error(`${pattern} matches nothing`);
    return pruned;
  };
  const imports = new Map([
    [
      '$embedLanguage',
      '(import "env" "embed" (func $embedLanguage (param i32 i32 i32 i32 i32) (result i32)))',
    ],
    [
      '$hostLanguage',
      '(import "env" "language" (func $hostLanguage (param i32 i32) (result i32)))',
    ],
  ]);
  let entries = forms
    .filter(
      (form) =>
        !form.text.includes('(export ') ||
        form.head === 'memory' ||
        /\(export "(?:inputPtr|lex|lexStream|reserve|append)"\)/.test(form.text)
    )
    .map((form) => {
      let text = form.text;
      const name = text.match(/^\((?:func|func-variant)\s+(\$\w+)/)?.[1];
      if (name === '$embedLanguage') return imports.get(name)!;
      if (name === '$embedLanguageByName')
        return '(func $embedLanguageByName (param $from i32) (param $to i32) (result i32) (call $hostLanguage (local.get $from) (i32.sub (local.get $to) (local.get $from))))';
      if (form.head === 'language-table' && selected !== undefined)
        text = text.replace(
          /\(language "([^"]+)" \$\w+/g,
          (entry, language: string) =>
            selected.has(language) ? entry : `(language "${language}" $hlPlain`
        );
      if (form.head !== 'func') return text;
      if (selected !== undefined) {
        const has = (...languages: string[]): boolean =>
          languages.some((language) => selected.has(language));
        // Modules without Glimmer drop its checks from the ECMAScript machine.
        if (!has('glimmer-js', 'glimmer-ts'))
          text = text.replaceAll('(call $ecmaHasGlimmer)', '(i32.const 0)');
        if (
          name === '$streamChunk' ||
          name === '$ecmaStreamLang' ||
          name === '$streamResumeLang'
        ) {
          text = text.replace(
            /\(i32\.eq\s+\(local\.get\s+\$lang\)\s+\(enum\.get\s+\$Language\.([\w-]+)\)\)/g,
            (comparison, language: string) =>
              selected.has(language) ? comparison : '(i32.const 0)'
          );
          const left = text
            .match(/\$Language\.[\w-]+/g)
            ?.find((reference) => !selected.has(reference.slice(10)));
          if (left !== undefined)
            throw new Error(`${name}: cannot prune ${left}`);
        }
        if (name === '$streamResetGlobals') {
          if (!has('js', 'jsx', 'ts', 'tsx', 'tsrx'))
            text = remove(
              text,
              /\(global\.set \$ecmaImport \(i32\.const 0\)\)/
            );
          if (!has('markdown', 'mdx'))
            text = remove(
              text,
              /\(global\.set \$markdown\w+ \(i32\.const 0\)\)|\(memory\.fill \(i32\.const \$mem\.markdownFenceStack\) \(i32\.const 0\) \(i32\.const 96\)\)/g
            );
          if (!has('php', 'hack', 'blade'))
            text = remove(text, /\(global\.set \$php\w+ \(i32\.const 0\)\)/g);
        }
        const drop: string[] = [];
        if (name === '$streamResumeLang') {
          if (!has('http')) drop.push('(call $httpStreamResume');
          if (!has('hurl')) drop.push('(call $hurlStreamResume');
          if (!has('shaderlab')) drop.push('(call $shaderlabStreamResume');
          if (!regions) drop.push('(call $streamResumeAnyRegion');
        }
        if (name === '$streamResumeAnyRegion') {
          if (!has('xml')) drop.push('(call $xmlStreamResumeTag');
          if (!has('vue')) drop.push('(call $vueStreamResumeTag');
          if (!has('svelte', 'astro')) drop.push('(call $braceStreamResumeTag');
        }
        if (name === '$streamResumeRegion') {
          if (!has('mdx')) drop.push('(global.set $jsxRootEnd');
          if (!has('vue', 'svelte', 'astro', 'mdx'))
            drop.push('(call $hlTsxExpressionStream');
        }
        if (name === '$markdownStreamResume' && !has('mdx'))
          drop.push('(call $mdxEsmResume');
        if (drop.length > 0) {
          const parts = splitTopLevelForms(text.slice(1, -1));
          for (const needle of drop)
            if (
              !parts.some(
                (part) => part.head === 'if' && part.text.includes(needle)
              )
            )
              throw new Error(`${name}: no branch has ${needle}`);
          text = `(${parts
            .filter(
              (part) =>
                part.head !== 'if' ||
                !drop.some((needle) => part.text.includes(needle))
            )
            .map((part) => part.text)
            .join(' ')})`;
        }
      }
      if (
        text.includes('$externalEmbedding') ||
        (text.includes('(i32.const 0)') &&
          name !== undefined &&
          ['$streamChunk', '$ecmaStreamLang', '$streamResumeLang'].includes(
            name
          ))
      )
        text = foldLexerForms(
          text.replaceAll('(global.get $externalEmbedding)', '(i32.const 1)')
        );
      return text;
    });
  entries.push(imports.get('$hostLanguage')!);
  entries.push(...flattened.imports);
  const definitions = new Map<string, string[]>();
  for (const text of entries) {
    const name =
      text.match(
        /^\((?:func|func-variant|global|const|enum|enum-map|keyword-table|keyword-pool|bitset|memory-region)\s+(\$[\w.]+)/
      )?.[1] ??
      text.match(/^\(import [^\n]+?\(func (\$\w+)/)?.[1] ??
      text.match(/^\(data \(i32\.const (\$mem\.[\w.]+)/)?.[1];
    if (name !== undefined)
      definitions.set(name, [...(definitions.get(name) ?? []), text]);
  }
  const used = new Set(['$streamWindow', '$streamStateLo', '$streamStateHi']);
  const keep = new Set<string>();
  const visit = (text: string): void => {
    keep.add(text);
    for (const [reference] of text.matchAll(/\$[\w.]+/g)) {
      let name = reference;
      while (!definitions.has(name) && name.includes('.'))
        name = name.slice(0, name.lastIndexOf('.'));
      used.add(name);
    }
    if (text.includes('byteset.get')) used.add('$mem.byteSets');
    if (text.startsWith('(keyword-table ')) {
      used.add('$mem.keywordPool');
      used.add('$mem.keywordPoolEnd');
      used.add('$lexKeywordLookup');
      used.add('$lexKeywordValue');
    }
  };
  for (const text of entries) {
    if (
      text.startsWith('(language-table') ||
      text.startsWith('(memory ') ||
      /\(export "(?:inputPtr|lex|lexStream|reserve|append)"\)/.test(text)
    )
      visit(text);
  }
  for (const name of used)
    for (const text of definitions.get(name) ?? []) visit(text);
  entries = entries.filter((text) => keep.has(text));
  // WARNING: A lexer that still opens a stream region needs the region
  // resume branch dropped above, or it is wrong when streamed. Build again
  // and keep it. ShaderLab resumes its own regions.
  if (
    selected !== undefined &&
    !regions &&
    used.has('$streamSetRegion') &&
    !selected.has('shaderlab')
  )
    return transformLexer(names, true);
  return transformWat(url, `(module\n${entries.join('\n')}\n)`);
}

/** Generate the checked-in language lookup and derive Lang from its keys. */
export function generateLanguages(languages: Record<string, number>): string {
  if (Object.keys(languages).length === 0)
    throw new Error('no language-table found');
  return (
    '// generated by scripts/build.ts - do not edit\n' +
    'const languages = {\n' +
    Object.entries(languages)
      .map(
        ([name, id]) =>
          `  ${/^[a-z_]\w*$/.test(name) ? name : `'${name}'`}: ${id},`
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

// WARNING: This file is also its build worker (see `new Worker` below). A
// worker compiles the lexer modules named in `workerData`; `all` is the bundle
// of every lexer.
if (!isMainThread && Array.isArray(workerData)) {
  const languageDir = new URL('../dist/langs/', import.meta.url);
  const languageDts =
    "import type { Language } from '../index.js';\n\n" +
    'declare const language: Language;\nexport default language;\n';
  for (const name of workerData as string[]) {
    const selected =
      name === 'all'
        ? undefined
        : name === 'ts'
          ? ['js', 'jsx', 'ts', 'tsx']
          : [name];
    const entry = name === 'ts' ? 'typescript' : name;
    const source = transformLexer(selected);
    const ids = new Set(selected?.map((name) => source.languages[name]));
    // WARNING: A lexer takes an alias with ID 0 as a name of its own, so the
    // plain-text names must stay out, or `text` runs the lexer as a language.
    const aliases = JSON.stringify(
      Object.fromEntries(
        Object.entries(source.languages).filter(
          ([, id]) => id !== 0 && (selected === undefined || ids.has(id))
        )
      )
    );
    const binary = optimizeWasm(wat2wasm(`${entry}.wat`, source.code));
    const descriptor = `{"name":"${entry}","aliases":${aliases},"wasm":"${Buffer.from(binary).toString('base64')}"}`;
    // WARNING: workerd cannot compile Wasm from bytes. Its export condition
    // selects the `.workerd.js` modules, which import the compiled `.wasm`.
    if (name === 'all') {
      writeFileSync(
        new URL('../langs.js', languageDir),
        `export const langs = [${descriptor}];\n`
      );
      writeFileSync(new URL('../langs.wasm', languageDir), binary);
      writeFileSync(
        new URL('../langs.workerd.js', languageDir),
        "import wasm from './langs.wasm';\n" +
          `export const langs = [{ name: 'all', aliases: ${aliases}, wasm }];\n`
      );
      writeFileSync(
        new URL('../langs.d.ts', languageDir),
        "import type { Language } from './index.js';\n\n" +
          'export declare const langs: readonly Language[];\n'
      );
      continue;
    }
    writeFileSync(
      new URL(`${entry}.js`, languageDir),
      `export default ${descriptor};\n`
    );
    writeFileSync(new URL(`${entry}.wasm`, languageDir), binary);
    writeFileSync(
      new URL(`${entry}.workerd.js`, languageDir),
      `import wasm from './${entry}.wasm';\n` +
        `export default { name: ${JSON.stringify(entry)}, aliases: ${aliases}, wasm };\n`
    );
    writeFileSync(new URL(`${entry}.d.ts`, languageDir), languageDts);
    if (name === 'ts') {
      for (const alias of ['ts', 'tsx', 'js', 'jsx', 'javascript']) {
        writeFileSync(
          new URL(`${alias}.js`, languageDir),
          "export { default } from './typescript.js';\n"
        );
        writeFileSync(
          new URL(`${alias}.workerd.js`, languageDir),
          "export { default } from './typescript.workerd.js';\n"
        );
        writeFileSync(new URL(`${alias}.d.ts`, languageDir), languageDts);
      }
    }
  }
}

// Emit the wasm, theme modules, and lazy loader before tsdown compiles the
// glue so it picks up the regenerated token and language tables.
if (isMainThread && import.meta.main) {
  const start = performance.now();
  const moduleUrl = import.meta.url;
  const sourceUrl = new URL('../src/highlights.wat', moduleUrl);
  const { code, enumMap, languages } = transformWat(sourceUrl);
  mkdirSync(new URL('../dist/langs/', moduleUrl), { recursive: true });
  // WARNING: The lexer modules take most of the build time, so workers
  // compile them while this thread compiles the combined module. Plain text
  // (ID 0) is built into every highlighter and has no module; the ECMAScript
  // languages share the `ts` one.
  const standalone = Object.keys(enumMap.get('$Language')!).filter(
    (name) => languages[name] !== 0 && !['js', 'jsx', 'tsx'].includes(name)
  );
  const workerCount = Math.max(1, availableParallelism() - 2);
  const workers = Array.from(
    { length: workerCount + 1 },
    (_, index) =>
      new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL(moduleUrl), {
          workerData:
            index === workerCount
              ? ['all']
              : standalone.filter((_, order) => order % workerCount === index),
        });
        worker.on('error', reject);
        worker.on('exit', (exitCode) =>
          exitCode === 0
            ? resolve()
            : reject(new Error(`lexer worker exited with code ${exitCode}`))
        );
      })
  );
  const wasmBytes = optimizeWasm(wat2wasm(sourceUrl.pathname, code));
  writeFileSync(new URL('../dist/highlights.wasm', moduleUrl), wasmBytes);
  writeFileSync(
    new URL('../dist/highlights.wasm.mjs', moduleUrl),
    `const s = atob("${Buffer.from(wasmBytes).toString('base64')}");\n` +
      `const b = new Uint8Array(s.length);\n` +
      `for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n` +
      `export default b;\n`,
    'utf-8'
  );
  const emitterUrl = new URL('../src/emitter.wat', moduleUrl);
  const emitter = optimizeWasm(
    wat2wasm(emitterUrl.pathname, transformWat(emitterUrl).code)
  );
  writeFileSync(new URL('../dist/emitter.wasm', moduleUrl), emitter);
  writeFileSync(
    new URL('../dist/emitter.wasm.mjs', moduleUrl),
    `const s = atob("${Buffer.from(emitter).toString('base64')}");\n` +
      'const b = new Uint8Array(s.length);\n' +
      'for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);\n' +
      'export default b;\n'
  );
  await Promise.all(workers);
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
      `export default ${JSON.stringify({ ...JSON.parse(json), id: name })};\n`
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
