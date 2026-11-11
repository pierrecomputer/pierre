import assert from 'node:assert/strict';
import type { LanguageRegistration } from 'shiki';

export interface SharedLanguage {
  words: string;
  streamdown: string;
  fence: string;
}

export interface LanguageCoverage {
  wordsLanguages: string[];
  sharedLanguages: SharedLanguage[];
  wordsOnlyLanguages: string[];
  streamdownLanguages: string[];
}

export interface DownloadCoverage extends LanguageCoverage {
  shared: {
    themes: [string, string];
    loadedStreamdownLanguages: string[];
  };
}

interface LanguageInfo {
  id: string;
  aliases?: readonly string[];
}

export interface OutputChunk {
  inputs: Record<string, unknown>;
  imports: readonly { path: string; kind: string }[];
}

// These lexers use different registered names, without a Shiki alias for the
// Words canonical name. Their fence names are accepted by both packages.
const renamedLanguages: Record<string, { streamdown: string; fence: string }> =
  {
    fortran: { streamdown: 'fortran-free-form', fence: 'fortran-free-form' },
    wat: { streamdown: 'wasm', fence: 'wasm' },
  };

/** Match one canonical sample per Words lexer, rather than treating aliases as languages. */
export function selectLanguageCoverage(
  canonicalWords: readonly string[],
  wordsAliases: Readonly<Record<string, number>>,
  streamdownInfo: readonly LanguageInfo[],
  advertised: readonly string[]
): LanguageCoverage {
  const wordsLanguages = [...canonicalWords].sort();
  assert.equal(new Set(wordsLanguages).size, wordsLanguages.length);
  const lexerIds = new Set(
    Object.values(wordsAliases).filter((id) => id !== 0)
  );
  const coveredIds = wordsLanguages.map((name) => {
    const id = wordsAliases[name];
    assert.ok(
      Number.isSafeInteger(id) && id > 0,
      `${name}: missing Words lexer`
    );
    return id;
  });
  assert.equal(
    new Set(coveredIds).size,
    wordsLanguages.length,
    'Canonical samples repeat a lexer through aliases'
  );
  assert.deepEqual(
    new Set(coveredIds),
    lexerIds,
    'Canonical samples must cover every Words lexer'
  );

  const streamdownLanguages = streamdownInfo.map(({ id }) => id).sort();
  assert.equal(new Set(streamdownLanguages).size, streamdownLanguages.length);
  const supported = new Set(advertised);
  const canonicalIds = new Set(streamdownLanguages);
  const aliases = new Map<string, string>();
  for (const { id, aliases: names = [] } of streamdownInfo) {
    assert.ok(
      supported.has(id),
      `${id}: metadata is not advertised by Streamdown`
    );
    for (const name of names) {
      assert.ok(
        !aliases.has(name) || aliases.get(name) === id,
        `${name}: ambiguous Shiki alias`
      );
      aliases.set(name, id);
    }
  }
  const canonical = (name: string): string | undefined =>
    canonicalIds.has(name) ? name : aliases.get(name);
  for (const name of supported)
    assert.ok(
      canonical(name) !== undefined,
      `${name}: advertised language lacks canonical metadata`
    );

  const sharedLanguages: SharedLanguage[] = [];
  const wordsOnlyLanguages: string[] = [];
  for (const words of wordsLanguages) {
    const renamed = renamedLanguages[words];
    const streamdown = renamed?.streamdown ?? canonical(words);
    if (streamdown === undefined) {
      wordsOnlyLanguages.push(words);
      continue;
    }
    const fence = renamed?.fence ?? words;
    assert.ok(
      canonicalIds.has(streamdown),
      `${streamdown}: unknown Shiki canonical language`
    );
    assert.ok(
      supported.has(fence) && canonical(fence) === streamdown,
      `${fence}: unsupported Streamdown fence`
    );
    assert.equal(
      wordsAliases[fence],
      wordsAliases[words],
      `${fence}: unsupported Words fence`
    );
    sharedLanguages.push({ words, streamdown, fence });
  }
  assert.equal(
    new Set(sharedLanguages.map(({ streamdown }) => streamdown)).size,
    sharedLanguages.length,
    'Shared languages must not repeat a Shiki grammar through aliases'
  );
  return {
    wordsLanguages,
    sharedLanguages,
    wordsOnlyLanguages,
    streamdownLanguages,
  };
}

/** Require mandatory embedded grammars while leaving optional lazy embeddings unloaded. */
export function requiredGrammarNames(
  grammars: readonly Pick<
    LanguageRegistration,
    'name' | 'embeddedLangs' | 'embeddedLanguages' | 'embeddedLangsLazy'
  >[]
): string[] {
  const names = new Set(grammars.map(({ name }) => name));
  for (const grammar of grammars)
    for (const embedded of grammar.embeddedLanguages ??
      grammar.embeddedLangs ??
      [])
      assert.ok(
        names.has(embedded),
        `${grammar.name}: missing embedded grammar ${embedded}`
      );
  return [...names].sort();
}

/** Include each actual output chunk once, following static imports from requested roots. */
export function staticChunkClosure(
  chunks: Readonly<Record<string, OutputChunk>>,
  roots: readonly string[]
): Set<string> {
  const loaded = new Set<string>();
  const visit = (path: string): void => {
    if (loaded.has(path)) return;
    const chunk = chunks[path];
    assert.ok(chunk !== undefined, `${path}: missing output chunk`);
    loaded.add(path);
    for (const { path: dependency, kind } of chunk.imports)
      if (kind !== 'dynamic-import') visit(dependency);
  };
  for (const path of roots) visit(path);
  return loaded;
}

/** Resolve one bundled source module to its unique output chunk. */
export function inputChunk(
  chunks: Readonly<Record<string, OutputChunk>>,
  matches: (path: string) => boolean
): string {
  const paths = Object.keys(chunks).filter((path) =>
    Object.keys(chunks[path].inputs).some((input) =>
      matches(input.replaceAll('\\', '/'))
    )
  );
  assert.equal(
    paths.length,
    1,
    'Source module must have exactly one output chunk'
  );
  return paths[0];
}

/** Read canonical samples and the actual installed plugins without compiling a highlighter. */
export async function loadDownloadCoverage(): Promise<DownloadCoverage> {
  // Dynamic file URLs keep benchmark-only source fixtures out of this package's
  // TypeScript project and consumer bundles; no Wasm build is needed here.
  const [
    { default: wordsAliases },
    { samples },
    { bundledLanguagesInfo },
    { code },
  ] = await Promise.all([
    import(
      new URL('../../../highlights/dist/languages.js', import.meta.url).href
    ) as Promise<{ default: Record<string, number> }>,
    import(
      new URL('../../../highlights/test/_samples.ts', import.meta.url).href
    ) as Promise<{ samples: Record<string, unknown> }>,
    import('shiki'),
    import('@streamdown/code'),
  ]);
  const coverage = selectLanguageCoverage(
    Object.keys(samples),
    wordsAliases,
    bundledLanguagesInfo,
    code.getSupportedLanguages()
  );
  const loaders = new Map(
    bundledLanguagesInfo.map((info) => [info.id, info.import])
  );
  const modules = await Promise.all(
    coverage.sharedLanguages.map(async ({ streamdown }) => {
      const load = loaders.get(streamdown);
      assert.ok(load !== undefined, `${streamdown}: missing grammar loader`);
      return (await load()).default;
    })
  );
  return {
    ...coverage,
    shared: {
      themes: ['github-light', 'github-dark'],
      loadedStreamdownLanguages: requiredGrammarNames(modules.flat()),
    },
  };
}
