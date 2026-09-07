import { afterEach, describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import {
  createHighlighterCore,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
} from 'shiki';

import { attachResolvedLanguages } from '../src/highlighter/languages/attachResolvedLanguages';
import { cleanUpResolvedLanguages } from '../src/highlighter/languages/cleanUpResolvedLanguages';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import { registerCustomLanguage } from '../src/highlighter/languages/registerCustomLanguage';
import { resolveLanguage } from '../src/highlighter/languages/resolveLanguage';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  DiffsHighlighter,
  FileContents,
  HighlighterTypes,
} from '../src/types';
import { getFiletypeFromFileName } from '../src/utils/getFiletypeFromFileName';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';

const contents = `export function App({ items }: { items: string[] }) @{
  <section>
    @if (items.length > 0) {
      @for (const item of items; key item) {
        <span>{item as string}</span>
      }
    } @else {
      <p>Empty</p>
    }
    <style>
      span { color: red; }
    </style>
    <script>
      const answer: number = 42;
    </script>
  </section>
}
const after: boolean = true;`;

const engines: HighlighterTypes[] = ['shiki-js', 'shiki-wasm'];
const themes = { light: 'github-light', dark: 'github-dark' };

afterEach(async () => {
  await disposeHighlighter();
  cleanUpResolvedLanguages();
});

// Check TextMate scopes at source positions, independent of a theme's colors
// or whether Shiki merges adjacent tokens that happen to share a color.
function expectTsrxScopes(highlighter: DiffsHighlighter): void {
  const tokens = highlighter
    .codeToTokens(contents, {
      lang: 'tsrx',
      theme: themes.dark,
      includeExplanation: true,
    })
    .tokens.flat();
  for (const [text, scope] of [
    ['@{', 'keyword.control.directive.tsrx'],
    ['@if', 'keyword.control.directive.tsrx'],
    ['@for', 'keyword.control.directive.tsrx'],
    ['@else', 'keyword.control.directive.tsrx'],
    ['as string', 'keyword.control.as.js'],
    ['color:', 'support.type.property-name.css'],
    ['number =', 'support.type.primitive.ts'],
    ['boolean =', 'support.type.primitive.js'],
  ]) {
    const offset = contents.indexOf(text);
    expect(offset).toBeGreaterThanOrEqual(0);
    const token = tokens.find(
      (token) =>
        token.offset <= offset && offset < token.offset + token.content.length
    );
    expect(
      token?.explanation?.flatMap((explanation) =>
        explanation.scopes.map((scope) => scope.scopeName)
      )
    ).toContain(scope);
  }
}

describe('TSRX highlighting', () => {
  test.each([
    'App.tsrx',
    'src/components/App.tsrx',
    'src\\components\\App.tsrx',
    'App.test.tsrx',
  ])('infers TSRX from %s', (filename) => {
    expect(getFiletypeFromFileName(filename)).toBe('tsrx');
  });

  test.each(engines)('highlights files and diffs with %s', async (engine) => {
    const file: FileContents = { name: 'App.tsrx', contents };
    const highlighter = await getSharedHighlighter({
      themes: Object.values(themes),
      langs: [getFiletypeFromFileName(file.name)],
      preferredHighlighter: engine,
    });
    expectTsrxScopes(highlighter);

    const renderedFile = renderFileWithHighlighter(file, highlighter, {
      theme: themes,
      tokenizeMaxLineLength: 1000,
      useTokenTransformer: false,
    });
    const html = toHtml({ type: 'root', children: renderedFile.code });
    expect(html).toContain('@if');
    expect(html).toContain('--diffs-token-light:');
    expect(html).toContain('--diffs-token-dark:');

    const diff = parseDiffFromFile(file, {
      ...file,
      contents: contents.replace('color: red', 'color: blue'),
    });
    const renderedDiff = renderDiffWithHighlighter(diff, highlighter, {
      theme: themes,
      lineDiffType: 'none',
      tokenizeMaxLineLength: 1000,
      maxLineDiffLength: 1000,
      useTokenTransformer: false,
    });
    const before = toHtml({
      type: 'root',
      children: renderedDiff.code.deletionLines,
    });
    const after = toHtml({
      type: 'root',
      children: renderedDiff.code.additionLines,
    });
    expect(before).toContain('red');
    expect(after).toContain('blue');
    expect(before).toContain('--diffs-token-dark:');
    expect(after).toContain('--diffs-token-light:');
  });

  test.each(engines)(
    'loads a transferred grammar payload synchronously with %s',
    async (engine) => {
      const resolved = structuredClone(await resolveLanguage('tsrx'));
      cleanUpResolvedLanguages();
      // A fresh core has no bundled language loaders, like a worker receiving
      // its language definitions from the main thread.
      const highlighter = (await createHighlighterCore({
        themes: [await import('shiki/themes/github-dark.mjs')],
        langs: [],
        engine:
          engine === 'shiki-js'
            ? createJavaScriptRegexEngine()
            : createOnigurumaEngine(import('shiki/wasm')),
      })) as DiffsHighlighter;
      try {
        attachResolvedLanguages(resolved, highlighter);
        expectTsrxScopes(highlighter);
      } finally {
        highlighter.dispose();
      }
    }
  );

  test('preserves explicitly registered TSRX language overrides', async () => {
    const customGrammar = {
      name: 'tsrx',
      scopeName: 'source.custom-tsrx',
      patterns: [],
      repository: {},
    };
    registerCustomLanguage('tsrx', () =>
      Promise.resolve({ default: [customGrammar] })
    );
    try {
      const resolved = await resolveLanguage('tsrx');
      expect(resolved.data).toEqual([customGrammar]);
    } finally {
      RegisteredCustomLanguages.delete('tsrx');
    }
  });
});
