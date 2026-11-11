import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inputChunk,
  loadDownloadCoverage,
  requiredGrammarNames,
  selectLanguageCoverage,
  staticChunkClosure,
} from '../benchmark/browser/coverage.ts';
import type { OutputChunk } from '../benchmark/browser/coverage.ts';

void test('counts canonical lexers once and does not expand their aliases into extra languages', () => {
  const coverage = selectLanguageCoverage(
    ['bash', 'cuda'],
    { plain: 0, bash: 1, sh: 1, shellscript: 1, shellsession: 1, cuda: 2 },
    [{ id: 'shellscript', aliases: ['bash', 'sh'] }, { id: 'shellsession' }],
    ['shellscript', 'shellsession', 'bash', 'sh']
  );
  assert.deepEqual(coverage.sharedLanguages, [
    { words: 'bash', streamdown: 'shellscript', fence: 'bash' },
  ]);
  assert.deepEqual(coverage.wordsOnlyLanguages, ['cuda']);
  assert.deepEqual(coverage.streamdownLanguages, [
    'shellscript',
    'shellsession',
  ]);
});

void test('uses documented registered-name equivalents and a fence accepted by both packages', () => {
  const coverage = selectLanguageCoverage(
    ['wat', 'lisp', 'fortran'],
    { plain: 0, fortran: 1, 'fortran-free-form': 1, wat: 2, wasm: 2, lisp: 3 },
    [
      { id: 'fortran-free-form' },
      { id: 'wasm' },
      { id: 'common-lisp', aliases: ['lisp'] },
    ],
    ['fortran-free-form', 'wasm', 'common-lisp', 'lisp']
  );
  assert.deepEqual(coverage.sharedLanguages, [
    {
      words: 'fortran',
      streamdown: 'fortran-free-form',
      fence: 'fortran-free-form',
    },
    { words: 'lisp', streamdown: 'common-lisp', fence: 'lisp' },
    { words: 'wat', streamdown: 'wasm', fence: 'wasm' },
  ]);
});

void test('rejects incomplete canonical sample coverage and aliases posing as extra lexers', () => {
  assert.throws(
    () =>
      selectLanguageCoverage(
        ['bash'],
        { bash: 1, css: 2 },
        [{ id: 'bash' }],
        ['bash']
      ),
    /cover every Words lexer/
  );
  assert.throws(
    () =>
      selectLanguageCoverage(
        ['bash', 'sh'],
        { bash: 1, sh: 1 },
        [{ id: 'bash', aliases: ['sh'] }],
        ['bash', 'sh']
      ),
    /repeat a lexer through aliases/
  );
});

void test('rejects a fence alias absent from the actual Streamdown plugin', () => {
  assert.throws(
    () =>
      selectLanguageCoverage(
        ['batch'],
        { batch: 1 },
        [{ id: 'bat', aliases: ['batch'] }],
        ['bat']
      ),
    /unsupported Streamdown fence/
  );
});

void test('requires embedded grammar arrays without loading optional lazy embeddings', () => {
  assert.deepEqual(
    requiredGrammarNames([
      {
        name: 'javascript',
        embeddedLangs: ['regexp'],
        embeddedLangsLazy: ['unrelated'],
      },
      { name: 'regexp' },
      { name: 'regexp' },
    ]),
    ['javascript', 'regexp']
  );
  assert.throws(
    () =>
      requiredGrammarNames([
        { name: 'javascript', embeddedLanguages: ['regexp'] },
      ]),
    /missing embedded grammar regexp/
  );
});

void test('deduplicates the requested static chunk union and excludes unrelated lazy grammars', () => {
  const chunk = (
    imports: { path: string; kind: string }[] = []
  ): OutputChunk => ({ inputs: {}, imports });
  const graph = {
    entry: chunk([
      { path: 'registry', kind: 'import-statement' },
      { path: 'core', kind: 'import-statement' },
      { path: 'body', kind: 'dynamic-import' },
    ]),
    registry: chunk([
      { path: 'a', kind: 'dynamic-import' },
      { path: 'b', kind: 'dynamic-import' },
      { path: 'unrelated', kind: 'dynamic-import' },
    ]),
    core: chunk(),
    body: chunk(),
    a: chunk([
      { path: 'common', kind: 'import-statement' },
      { path: 'embedded', kind: 'import-statement' },
    ]),
    b: chunk([{ path: 'common', kind: 'import-statement' }]),
    common: chunk([{ path: 'a', kind: 'import-statement' }]),
    embedded: chunk(),
    unrelated: chunk(),
  };
  assert.deepEqual(
    staticChunkClosure(graph, ['entry']),
    new Set(['entry', 'registry', 'core'])
  );
  assert.deepEqual(
    staticChunkClosure(graph, ['entry', 'body', 'a', 'b', 'a']),
    new Set([
      'entry',
      'registry',
      'core',
      'body',
      'a',
      'common',
      'embedded',
      'b',
    ])
  );
  assert.throws(
    () => staticChunkClosure(graph, ['missing']),
    /missing output chunk/
  );
});

void test('resolves an exact module to one chunk on either path separator', () => {
  const graph = {
    grammar: {
      inputs: { 'node_modules\\@shikijs\\langs\\dist\\typescript.mjs': {} },
      imports: [],
    },
    unrelated: {
      inputs: { 'node_modules/@shikijs/langs/dist/javascript.mjs': {} },
      imports: [],
    },
  };
  assert.equal(
    inputChunk(graph, (path) =>
      path.endsWith('/@shikijs/langs/dist/typescript.mjs')
    ),
    'grammar'
  );
  assert.throws(
    () => inputChunk(graph, (path) => path.endsWith('.mjs')),
    /exactly one output chunk/
  );
});

void test('published coverage accounts for every installed Words lexer and real shared grammar', async () => {
  const coverage = await loadDownloadCoverage();
  assert.equal(coverage.wordsLanguages.length, 152);
  assert.equal(coverage.streamdownLanguages.length, 242);
  assert.equal(coverage.sharedLanguages.length, 148);
  assert.deepEqual(coverage.wordsOnlyLanguages, [
    'cuda',
    'groq',
    'promql',
    'tsrx',
  ]);
  assert.equal(coverage.shared.loadedStreamdownLanguages.length, 163);
  assert.ok(coverage.shared.loadedStreamdownLanguages.includes('regexp'));
  assert.ok(
    !coverage.shared.loadedStreamdownLanguages.includes('shellsession')
  );
  assert.deepEqual(coverage.shared.themes, ['github-light', 'github-dark']);
});
