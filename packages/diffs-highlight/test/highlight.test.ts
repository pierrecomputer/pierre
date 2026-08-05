import type { HighlighterCore } from '@shikijs/core';
/**
 * Guards the tokenizing side of the plugin, where the standing risk is Shiki's
 * JavaScript regex engine: the plugin sandbox cannot load WebAssembly, so a
 * grammar that only works under Oniguruma would fail at runtime in Figma with no
 * other warning. Since the picker offers every bundled language, that has to be
 * checked across all of them, not just the popular ones.
 */
import { beforeAll, describe, expect, test } from 'bun:test';

import {
  createProbeHighlighter,
  highlightToBindings,
  LANGUAGES,
} from '../src/ui/highlight';

/**
 * Languages spot-checked for real role variety, with a snippet each. These are
 * the ones the plugin is most likely used on; the sweep below covers the rest.
 */
const SAMPLES: Record<string, string> = {
  typescript: 'const enabled: boolean = true; // note\nexport function go() {}',
  tsx: 'const App = () => <div className="a">{name}</div>;',
  javascript: 'let total = 0;\nfor (const x of xs) total += x; // sum',
  jsx: 'export default () => <p title="hi">{count}</p>;',
  python: 'def go(name: str) -> int:\n    return len(name)  # count',
  go: 'package main\n\nfunc main() { println("hi") }',
  rust: 'fn main() {\n    let x: u32 = 1; // one\n}',
  bash: 'set -euo pipefail\necho "$HOME" # home',
  json: '{ "name": "pierre", "count": 2 }',
  html: '<section class="a"><!-- note --><b>hi</b></section>',
  css: '.a { color: #fff; /* note */ }',
  markdown: '# Title\n\nSome `code` and a [link](https://pierre.co).',
};

/** Generic enough to exercise comments, strings, numbers, and punctuation. */
const SWEEP_SAMPLE = `# comment line
const x = "string" /* 1.5 */
function f(a, b) { return a + b; }
<tag attr="v">text</tag>
[section]
key: value`;

let highlighter: HighlighterCore;

beforeAll(async () => {
  highlighter = await createProbeHighlighter();
});

describe('the language list', () => {
  test('offers Shiki’s full bundle, sorted by display name', () => {
    expect(LANGUAGES.length).toBeGreaterThan(200);

    const labels = LANGUAGES.map((language) => language.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));

    const ids = LANGUAGES.map((language) => language.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('lists canonical ids only, leaving aliases out of the picker', () => {
    const ids = LANGUAGES.map((language) => language.id);
    // `bash` is an alias of `shellscript`; only the latter belongs in the list.
    expect(ids).toContain('shellscript');
    expect(ids).not.toContain('bash');
  });
});

describe('spot-checked languages', () => {
  for (const [id, sample] of Object.entries(SAMPLES)) {
    test(`${id} resolves to several distinct roles`, async () => {
      const result = await highlightToBindings(highlighter, sample, id);

      expect(result.bindings.length).toBeGreaterThan(0);
      // A grammar the engine cannot run yields one flat unscoped range, so
      // several distinct roles is the signal that it really tokenized.
      const roles = new Set(
        result.bindings.map((binding) => binding.variableName)
      );
      expect(roles.size).toBeGreaterThan(1);
      // Every color the probe theme produces must be a known Pierre role.
      expect(result.unmatchedColors).toEqual([]);
    });
  }
});

describe('every bundled language', () => {
  test('loads and tokenizes under the JavaScript regex engine', async () => {
    const failures: string[] = [];

    for (const language of LANGUAGES) {
      try {
        await highlightToBindings(highlighter, SWEEP_SAMPLE, language.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${language.id}: ${message.split('\n')[0] ?? ''}`);
      }
    }

    expect(failures).toEqual([]);
  }, 120_000);
});

describe('highlightToBindings', () => {
  test('accepts an alias as readily as its canonical id', async () => {
    const code = 'echo "$HOME" # home';
    const viaAlias = await highlightToBindings(highlighter, code, 'bash');
    const viaId = await highlightToBindings(highlighter, code, 'shellscript');

    expect(viaAlias.bindings.length).toBeGreaterThan(0);
    expect(viaAlias.bindings).toEqual(viaId.bindings);
  });

  test('rejects a language that is not in the bundle', async () => {
    let message = '';
    try {
      await highlightToBindings(highlighter, 'x = 1', 'not-a-language');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Unknown language: not-a-language');
  });

  test('keeps offsets aligned with Figma soft line breaks', async () => {
    // U+2028 is how Figma stores a soft line break. Swapping in a newline has to
    // leave every offset where it was, so the two identical lines below must
    // produce the same role at the same distance into each line.
    const code = 'const a = 1;\u2028const b = 2;';
    const secondLineStart = code.indexOf('const', 1);
    const result = await highlightToBindings(highlighter, code, 'typescript');

    const firstDeclaration = result.bindings.find(
      (binding) => binding.start === 0
    );
    expect(firstDeclaration?.end).toBe('const'.length);
    expect(
      result.bindings.find((binding) => binding.start === secondLineStart)
    ).toEqual({
      start: secondLineStart,
      end: secondLineStart + 'const'.length,
      variableName: firstDeclaration?.variableName ?? '',
    });
  });

  test('separates the number from the semicolon on its very first call', async () => {
    // The warm-up in ensureLanguage exists for exactly this: without it, a fresh
    // highlighter's first tokenization returns `1;` as a single token.
    const fresh = await createProbeHighlighter();
    const result = await highlightToBindings(
      fresh,
      'const a = 1;',
      'typescript'
    );
    const last = result.bindings[result.bindings.length - 1];

    expect(last).toEqual({
      start: 11,
      end: 12,
      variableName: 'syntax/punctuation',
    });
  });

  test('produces ranges inside the layer text', async () => {
    const code = SAMPLES.typescript ?? '';
    const result = await highlightToBindings(highlighter, code, 'typescript');

    for (const binding of result.bindings) {
      expect(binding.start).toBeGreaterThanOrEqual(0);
      expect(binding.end).toBeLessThanOrEqual(code.length);
      expect(binding.end).toBeGreaterThan(binding.start);
    }
  });
});
