import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter, getSharedHighlighter } from '../src/highlighter';
import type { DiffsHighlighter } from '../src/types';
import { getHighlighterThemeStyles } from '../src/utils/getHighlighterThemeStyles';

// Byte-for-byte parity fixtures. These lock the exact --diffs-* string that the
// pre-theming getHighlighterThemeStyles produced for the Pierre themes, so the
// refactor onto normalizeThemeColors cannot drift the output. The values were
// captured from the legacy implementation. Any change here is a real behavior
// change and must be intentional.
const SINGLE_DARK =
  'color:#fafafa;background-color:#0a0a0a;--diffs-fg:#fafafa;--diffs-bg:#0a0a0a;--diffs-addition-color:#07c480;--diffs-deletion-color:#ff2e3f;--diffs-modified-color:#009fff;';

const PAIRED_DARK_LIGHT =
  '--diffs-dark:#fafafa;--diffs-dark-bg:#0a0a0a;--diffs-dark-addition-color:#07c480;--diffs-dark-deletion-color:#ff2e3f;--diffs-dark-modified-color:#009fff;--diffs-light:#0a0a0a;--diffs-light-bg:#ffffff;--diffs-light-addition-color:#18a46c;--diffs-light-deletion-color:#d52c36;--diffs-light-modified-color:#009fff;';

// A custom `prefix` is applied only to the git-color variables, not to the
// fg/bg/global vars — this asserts that asymmetry survives the refactor.
const SINGLE_LIGHT_PREFIXED =
  'color:#0a0a0a;background-color:#ffffff;--diffs-fg:#0a0a0a;--diffs-bg:#ffffff;--diffs-custom-addition-color:#18a46c;--diffs-custom-deletion-color:#d52c36;--diffs-custom-modified-color:#009fff;';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

describe('getHighlighterThemeStyles --diffs-* parity', () => {
  test('single theme emits color/bg/global fg/bg and 2-link git colors', () => {
    expect(
      getHighlighterThemeStyles({ theme: 'pierre-dark', highlighter })
    ).toBe(SINGLE_DARK);
  });

  test('paired dark/light theme emits mode-prefixed forms in order', () => {
    expect(
      getHighlighterThemeStyles({
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        highlighter,
      })
    ).toBe(PAIRED_DARK_LIGHT);
  });

  test('custom prefix is applied to git-color vars only', () => {
    expect(
      getHighlighterThemeStyles({
        theme: 'pierre-light',
        highlighter,
        prefix: 'custom',
      })
    ).toBe(SINGLE_LIGHT_PREFIXED);
  });

  test('preserves CSS variable themes and style-based git colors', () => {
    const raw = {
      name: 'css-variables',
      cssVariables: true,
      style: {
        'terminal.ansi.green': '#00ff00',
        deleted: '#ff0000',
        modified: '#0000ff',
      },
    };
    expect(
      getHighlighterThemeStyles({
        theme: 'pierre-dark',
        highlighter: { ...highlighter, getTheme: () => raw },
      })
    ).toBe(
      'color:var(--hls-foreground);background-color:var(--hls-background);--diffs-fg:var(--hls-foreground);--diffs-bg:var(--hls-background);--diffs-addition-color:#00ff00;--diffs-deletion-color:#ff0000;--diffs-modified-color:#0000ff;'
    );
  });

  test('preserves TextMate surfaces and git color fallbacks', () => {
    const raw = {
      name: 'workbench-colors',
      colors: {
        'editor.foreground': '#123456',
        'editor.background': '#abcdef',
        'terminal.ansiGreen': '#00ff00',
        'editorGutter.deletedBackground': '#ff0000',
      },
    };
    expect(
      getHighlighterThemeStyles({
        theme: 'pierre-dark',
        highlighter: { ...highlighter, getTheme: () => raw },
      })
    ).toBe(
      'color:#123456;background-color:#abcdef;--diffs-fg:#123456;--diffs-bg:#abcdef;--diffs-addition-color:#00ff00;--diffs-deletion-color:#ff0000;'
    );
  });
});
