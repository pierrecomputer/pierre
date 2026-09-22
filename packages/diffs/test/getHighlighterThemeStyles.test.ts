import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type { DiffsHighlighter } from '../src/types';
import { getHighlighterThemeStyles } from '../src/utils/getHighlighterThemeStyles';

// Stable output fixtures. The git-color portion stays byte-identical to the
// pre-theming implementation, while editor search variables are intentionally
// included so CodeView can share Editor search colors.
const SINGLE_DARK =
  'color:#fafafa;background-color:#0a0a0a;--diffs-fg:#fafafa;--diffs-bg:#0a0a0a;--diffs-editor-selection-bg:#009fff4d;--diffs-addition-color:#07c480;--diffs-deletion-color:#ff2e3f;--diffs-modified-color:#009fff;';

const PAIRED_DARK_LIGHT =
  '--diffs-dark:#fafafa;--diffs-dark-bg:#0a0a0a;--diffs-dark-editor-selection-bg:#009fff4d;--diffs-dark-addition-color:#07c480;--diffs-dark-deletion-color:#ff2e3f;--diffs-dark-modified-color:#009fff;--diffs-light:#0a0a0a;--diffs-light-bg:#ffffff;--diffs-light-editor-selection-bg:#009fff2e;--diffs-editor-selection-bg:light-dark(var(--diffs-light-editor-selection-bg, var(--diffs-line-bg)), var(--diffs-dark-editor-selection-bg, var(--diffs-line-bg)));--diffs-editor-match-bg:light-dark(var(--diffs-light-editor-match-bg, var(--diffs-light-editor-selection-bg, var(--diffs-editor-selection-bg))), var(--diffs-dark-editor-match-bg, var(--diffs-dark-editor-selection-bg, var(--diffs-editor-selection-bg))));--diffs-editor-match-highlight-bg:light-dark(var(--diffs-light-editor-match-highlight-bg, #ff963288), var(--diffs-dark-editor-match-highlight-bg, #ff963266));--diffs-light-addition-color:#18a46c;--diffs-light-deletion-color:#d52c36;--diffs-light-modified-color:#009fff;';

// A custom `prefix` is applied only to the git-color variables, not to the
// fg/bg/global vars — this asserts that asymmetry survives the refactor.
const SINGLE_LIGHT_PREFIXED =
  'color:#0a0a0a;background-color:#ffffff;--diffs-fg:#0a0a0a;--diffs-bg:#ffffff;--diffs-editor-selection-bg:#009fff2e;--diffs-custom-addition-color:#18a46c;--diffs-custom-deletion-color:#d52c36;--diffs-custom-modified-color:#009fff;';

let highlighter: DiffsHighlighter;

beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
});

afterAll(async () => {
  await disposeHighlighter();
});

describe('getHighlighterThemeStyles --diffs-* output', () => {
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

  test('explicit editor find colors are emitted for CodeView search highlights', () => {
    const customHighlighter = {
      getTheme() {
        return {
          name: 'custom',
          type: 'dark',
          fg: '#ffffff',
          bg: '#000000',
          colors: {
            'editor.selectionBackground': '#111111',
            'editor.findMatchBackground': '#222222',
            'editor.findMatchHighlightBackground': '#333333',
          },
        };
      },
    } as unknown as DiffsHighlighter;

    expect(
      getHighlighterThemeStyles({
        theme: 'pierre-dark',
        highlighter: customHighlighter,
      })
    ).toContain(
      '--diffs-editor-selection-bg:#111111;--diffs-editor-match-bg:#222222;--diffs-editor-match-highlight-bg:#333333;'
    );
  });
});
