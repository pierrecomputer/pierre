import { expect, test } from 'bun:test';

import { getThemeStyle } from '../src/utils/getThemeStyle';

test('reads style-based UI colors without requiring a backend syntax format', () => {
  const theme = {
    name: 'custom-style-theme',
    style: {
      'editor.foreground': '#abcdef',
      'editor.background': '#123456',
      players: [{ selection: '#345678' }],
    },
  };
  expect(getThemeStyle(theme)).toBe(theme.style);
});

test('maps workbench colors and git fallbacks into editor styles', () => {
  const theme = {
    name: 'custom-workbench-theme',
    type: 'light' as const,
    fg: '#123456',
    bg: '#abcdef',
    colors: {
      'terminal.ansiGreen': '#00ff00',
      'editorGutter.deletedBackground': '#ff0000',
      'editor.lineHighlightBackground': '#eeeeee',
      'editorBracketMatch.background': '#dddddd',
      'editorCursor.foreground': '#111111',
      'editor.selectionBackground': '#cccccc',
    },
  };
  const resolved = getThemeStyle(theme);
  expect(resolved).toMatchObject({
    'editor.foreground': '#123456',
    'editor.background': '#abcdef',
    created: '#00ff00',
    deleted: '#ff0000',
    'editor.active_line.background': '#eeeeee',
    'editor.document_highlight.bracket_background': '#dddddd',
    players: [{ cursor: '#111111', selection: '#cccccc' }],
  });
  expect(getThemeStyle(theme)).toBe(resolved);
});
