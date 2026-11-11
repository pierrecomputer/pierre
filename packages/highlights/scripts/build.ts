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
      if (
        selected !== undefined &&
        ['$streamChunk', '$ecmaStreamLang', '$streamResumeLang'].includes(
          name ?? ''
        )
      ) {
        text = text.replace(
          /\(i32\.eq \(local\.get \$lang\) \(enum\.get \$Language\.([\w-]+)\)\)/g,
          (comparison, language: string) =>
            selected.has(language) ? comparison : '(i32.const 0)'
        );
      }
      if (selected !== undefined && name === '$streamResetGlobals') {
        if (
          ![...selected].some((name) =>
            ['js', 'jsx', 'ts', 'tsx', 'tsrx'].includes(name)
          )
        )
          text = text.replace(
            /\(global\.set \$ecmaImport \(i32\.const 0\)\)/,
            ''
          );
        if (!selected.has('markdown') && !selected.has('mdx'))
          text = text.replace(
            /\(global\.set \$markdown\w+ \(i32\.const 0\)\)|\(memory\.fill \(i32\.const \$mem\.markdownFenceStack\) \(i32\.const 0\) \(i32\.const 96\)\)/g,
            ''
          );
        if (
          !selected.has('php') &&
          !selected.has('hack') &&
          !selected.has('blade')
        )
          text = text.replace(/\(global\.set \$php\w+ \(i32\.const 0\)\)/g, '');
      }
      if (selected !== undefined && name === '$streamResumeLang') {
        for (const [call, needed] of [
          ['$httpStreamResume', selected.has('http')],
          ['$shaderlabStreamResume', selected.has('shaderlab')],
          ['$streamResumeAnyRegion', regions],
        ] as const) {
          if (needed) continue;
          const parts = splitTopLevelForms(text.slice(1, -1));
          text = `(${parts
            .filter(
              (part) =>
                part.head !== 'if' || !part.text.includes(`(call ${call}`)
            )
            .map((part) => part.text)
            .join(' ')})`;
        }
      }
      if (selected !== undefined && name === '$streamResumeAnyRegion') {
        const branches = [
          ['$xmlStreamResumeTag', ['xml']],
          ['$vueStreamResumeTag', ['vue']],
          ['$braceStreamResumeTag', ['svelte', 'astro']],
        ] as const;
        for (const [call, languages] of branches) {
          if (languages.some((language) => selected.has(language))) continue;
          text = `(${splitTopLevelForms(text.slice(1, -1))
            .filter(
              (part) =>
                part.head !== 'if' || !part.text.includes(`(call ${call}`)
            )
            .map((part) => part.text)
            .join(' ')})`;
        }
      }
      if (selected !== undefined && name === '$streamResumeRegion') {
        const parts = splitTopLevelForms(text.slice(1, -1));
        text = `(${parts
          .filter((part) => {
            if (part.head !== 'if') return true;
            if (
              part.text.includes('(global.set $jsxRootEnd') &&
              !selected.has('mdx')
            )
              return false;
            if (
              part.text.includes('(call $hlTsxExpressionStream') &&
              !['vue', 'svelte', 'astro', 'mdx'].some((language) =>
                selected.has(language)
              )
            )
              return false;
            return true;
          })
          .map((part) => part.text)
          .join(' ')})`;
      }
      if (
        selected !== undefined &&
        !selected.has('mdx') &&
        name === '$markdownStreamResume'
      )
        text = `(${splitTopLevelForms(text.slice(1, -1))
          .filter(
            (part) =>
              part.head !== 'if' || !part.text.includes('(call $mdxEsmResume')
          )
          .map((part) => part.text)
          .join(' ')})`;
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
  const lexer = transformLexer();
  const combinedLexer = optimizeWasm(wat2wasm('lexer.wat', lexer.code));
  const languageDts =
    "import type { Language } from '../index.js';\n\n" +
    'declare const language: Language;\nexport default language;\n';
  const languageDir = new URL('../dist/langs/', moduleUrl);
  mkdirSync(languageDir, { recursive: true });
  const languageNames = Object.keys(lexer.enumMap.get('$Language')!);
  const ecma = new Set(['js', 'jsx', 'ts', 'tsx']);
  for (const name of languageNames) {
    if (ecma.has(name) && name !== 'ts') continue;
    const selected = ecma.has(name) ? [...ecma] : [name];
    const ids = new Set(selected.map((name) => languages[name]));
    const aliases = Object.fromEntries(
      Object.entries(languages).filter(([, id]) => ids.has(id))
    );
    const entry = name === 'ts' ? 'typescript' : name;
    const source = transformLexer(selected);
    const binary = optimizeWasm(wat2wasm(`${entry}.wat`, source.code));
    writeFileSync(
      new URL(`${entry}.js`, languageDir),
      `export default ${JSON.stringify({ name: entry, aliases, wasm: Buffer.from(binary).toString('base64') })};\n`
    );
    // WARNING: workerd cannot compile Wasm from bytes. Its export condition
    // selects these modules, which import the compiled `.wasm` file.
    writeFileSync(new URL(`${entry}.wasm`, languageDir), binary);
    writeFileSync(
      new URL(`${entry}.workerd.js`, languageDir),
      `import wasm from './${entry}.wasm';\n` +
        `export default { name: ${JSON.stringify(entry)}, aliases: ${JSON.stringify(aliases)}, wasm };\n`
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
  writeFileSync(
    new URL('../dist/langs.js', moduleUrl),
    `export const langs = [${JSON.stringify({ name: 'all', aliases: languages, wasm: Buffer.from(combinedLexer).toString('base64') })}];\n`
  );
  writeFileSync(new URL('../dist/langs.wasm', moduleUrl), combinedLexer);
  writeFileSync(
    new URL('../dist/langs.workerd.js', moduleUrl),
    "import wasm from './langs.wasm';\n" +
      `export const langs = [{ name: 'all', aliases: ${JSON.stringify(languages)}, wasm }];\n`
  );
  writeFileSync(
    new URL('../dist/langs.d.ts', moduleUrl),
    "import type { Language } from './index.js';\n\n" +
      'export declare const langs: readonly Language[];\n'
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
