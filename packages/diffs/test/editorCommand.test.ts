import { describe, expect, test } from 'bun:test';

import {
  type EditorCommand,
  resolveEditorCommandFromKeyboardEvent,
  resolveFindAgainShortcut,
} from '../src/editor/command';

type ShortcutKeyboardEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key' | 'code'
>;
type ShortcutCase = {
  event: Partial<ShortcutKeyboardEvent> & Pick<ShortcutKeyboardEvent, 'key'>;
  expected: EditorCommand | undefined;
};

function event({
  key,
  ...overrides
}: Partial<ShortcutKeyboardEvent> &
  Pick<ShortcutKeyboardEvent, 'key'>): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
    key,
  } as KeyboardEvent;
}

function withPlatform(platform: string, run: () => void): void {
  const navigator = globalThis.navigator;
  const originalPlatform = navigator.platform;
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });

  try {
    run();
  } finally {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
  }
}

function expectShortcuts(platform: string, cases: ShortcutCase[]): void {
  const isMac = /macOS|MacIntel|iPhone|iPad|iPod/i.test(platform);
  withPlatform(platform, () => {
    for (const { event: shortcutEvent, expected } of cases) {
      expect(
        resolveEditorCommandFromKeyboardEvent(event(shortcutEvent), isMac)
      ).toBe(expected);
    }
  });
}

describe('resolveEditorShortcutCommand', () => {
  test('uses command shortcuts on macOS', () => {
    expectShortcuts('MacIntel', [
      { event: { key: 'z', metaKey: true }, expected: 'undo' },
      { event: { key: 'z', metaKey: true, shiftKey: true }, expected: 'redo' },
      { event: { key: 'a', metaKey: true }, expected: 'selectAll' },
      {
        event: { key: 'ArrowUp', metaKey: true },
        expected: 'moveCursorToDocStart',
      },
      {
        event: { key: 'ArrowDown', metaKey: true },
        expected: 'moveCursorToDocEnd',
      },
      { event: { key: 'ArrowUp', altKey: true }, expected: 'moveLineUp' },
      { event: { key: 'ArrowDown', altKey: true }, expected: 'moveLineDown' },
      {
        event: { key: 'ArrowUp', altKey: true, shiftKey: true },
        expected: 'copyLineUp',
      },
      {
        event: { key: 'ArrowDown', altKey: true, shiftKey: true },
        expected: 'copyLineDown',
      },
      {
        event: { key: 'Enter', metaKey: true },
        expected: 'insertBlankLine',
      },
      { event: { key: '[', metaKey: true }, expected: 'indentLess' },
      { event: { key: ']', metaKey: true }, expected: 'indentMore' },
      { event: { key: '/', metaKey: true }, expected: 'toggleComment' },
      {
        event: { key: 'A', code: 'KeyA', altKey: true, shiftKey: true },
        expected: 'toggleBlockComment',
      },
      { event: { key: 'Escape' }, expected: 'simplifySelection' },
      {
        event: { key: 'p', altKey: true, ctrlKey: true },
        expected: 'moveLineUp',
      },
      {
        event: { key: 'π', code: 'KeyP', altKey: true, ctrlKey: true },
        expected: 'moveLineUp',
      },
      {
        event: { key: 'n', altKey: true, ctrlKey: true },
        expected: 'moveLineDown',
      },
      {
        event: { key: '~', code: 'KeyN', altKey: true, ctrlKey: true },
        expected: 'moveLineDown',
      },
    ]);
  });

  test('uses control shortcuts on windows and linux', () => {
    expectShortcuts('Linux x86_64', [
      { event: { key: 'z', ctrlKey: true }, expected: 'undo' },
      { event: { key: 'z', ctrlKey: true, shiftKey: true }, expected: 'redo' },
      { event: { key: 'y', ctrlKey: true }, expected: 'redo' },
      { event: { key: 'a', ctrlKey: true }, expected: 'selectAll' },
      {
        event: { key: 'Home', ctrlKey: true },
        expected: 'moveCursorToDocStart',
      },
      { event: { key: 'End', ctrlKey: true }, expected: 'moveCursorToDocEnd' },
      { event: { key: 'ArrowUp', altKey: true }, expected: 'moveLineUp' },
      { event: { key: 'ArrowDown', altKey: true }, expected: 'moveLineDown' },
      {
        event: { key: 'ArrowUp', altKey: true, shiftKey: true },
        expected: 'copyLineUp',
      },
      {
        event: { key: 'ArrowDown', altKey: true, shiftKey: true },
        expected: 'copyLineDown',
      },
      {
        event: { key: 'Enter', ctrlKey: true },
        expected: 'insertBlankLine',
      },
      { event: { key: '[', ctrlKey: true }, expected: 'indentLess' },
      { event: { key: ']', ctrlKey: true }, expected: 'indentMore' },
      { event: { key: '/', ctrlKey: true }, expected: 'toggleComment' },
      {
        event: { key: 'A', code: 'KeyA', altKey: true, shiftKey: true },
        expected: 'toggleBlockComment',
      },
      { event: { key: 'Escape' }, expected: 'simplifySelection' },
      {
        event: { key: 'p', altKey: true, ctrlKey: true },
        expected: 'moveLineUp',
      },
      {
        event: {
          key: 'Unidentified',
          code: 'KeyP',
          altKey: true,
          ctrlKey: true,
        },
        expected: 'moveLineUp',
      },
      {
        event: { key: 'n', altKey: true, ctrlKey: true },
        expected: 'moveLineDown',
      },
      {
        event: {
          key: 'Unidentified',
          code: 'KeyN',
          altKey: true,
          ctrlKey: true,
        },
        expected: 'moveLineDown',
      },
    ]);
  });

  test('ignores modified alt shortcuts and unsupported navigation', () => {
    expectShortcuts('Linux x86_64', [
      { event: { key: 'ArrowUp', ctrlKey: true }, expected: undefined },
      {
        event: { key: 'ArrowUp', ctrlKey: true, altKey: true },
        expected: undefined,
      },
      {
        event: { key: 'ArrowDown', ctrlKey: true, altKey: true },
        expected: undefined,
      },
      { event: { key: 'z', ctrlKey: true, altKey: true }, expected: undefined },
    ]);
    expectShortcuts('MacIntel', [
      {
        event: { key: 'ArrowUp', metaKey: true, altKey: true },
        expected: undefined,
      },
      {
        event: { key: 'ArrowDown', metaKey: true, altKey: true },
        expected: undefined,
      },
    ]);
  });

  test('maps tab and shift+tab without primary modifier', () => {
    expectShortcuts('Linux x86_64', [
      { event: { key: 'Tab' }, expected: 'indent' },
      { event: { key: 'Tab', shiftKey: true }, expected: 'outdent' },
      { event: { key: 'Tab', ctrlKey: true }, expected: undefined },
    ]);
  });

  test('opens the search panel with the find shortcut on macOS', () => {
    expectShortcuts('MacIntel', [
      { event: { key: 'f', metaKey: true }, expected: 'openSearchPanel' },
      {
        event: { key: 'f', metaKey: true, altKey: true },
        expected: 'openSearchReplacePanel',
      },
      // Option+F emits a dead key ('ƒ') on macOS, so the physical F is
      // recognized through event.code instead of the character.
      {
        event: { key: 'ƒ', code: 'KeyF', metaKey: true, altKey: true },
        expected: 'openSearchReplacePanel',
      },
      { event: { key: 'f', ctrlKey: true }, expected: undefined },
    ]);
  });

  test('opens the search panel with the find shortcut on windows and linux', () => {
    expectShortcuts('Linux x86_64', [
      { event: { key: 'f', ctrlKey: true }, expected: 'openSearchPanel' },
      {
        event: { key: 'f', ctrlKey: true, altKey: true },
        expected: 'openSearchReplacePanel',
      },
      { event: { key: 'f', metaKey: true }, expected: undefined },
    ]);
  });

  test('maps the find-next shortcut', () => {
    expectShortcuts('MacIntel', [
      { event: { key: 'd', metaKey: true }, expected: 'findNextMatch' },
    ]);
    expectShortcuts('Linux x86_64', [
      { event: { key: 'd', ctrlKey: true }, expected: 'findNextMatch' },
      { event: { key: 'd' }, expected: undefined },
    ]);
  });

  test('expands the selection to the document edges with shift', () => {
    expectShortcuts('MacIntel', [
      {
        event: { key: 'ArrowUp', metaKey: true, shiftKey: true },
        expected: 'expandSelectionDocStart',
      },
      {
        event: { key: 'ArrowDown', metaKey: true, shiftKey: true },
        expected: 'expandSelectionDocEnd',
      },
    ]);
    expectShortcuts('Linux x86_64', [
      {
        event: { key: 'Home', ctrlKey: true, shiftKey: true },
        expected: 'expandSelectionDocStart',
      },
      {
        event: { key: 'End', ctrlKey: true, shiftKey: true },
        expected: 'expandSelectionDocEnd',
      },
    ]);
  });
});

describe('resolveFindAgainShortcut', () => {
  function expectFindAgain(
    platform: string,
    cases: Array<{
      event: Partial<ShortcutKeyboardEvent> &
        Pick<ShortcutKeyboardEvent, 'key'>;
      expected: 'next' | 'previous' | undefined;
    }>
  ): void {
    const isMac = /macOS|MacIntel|iPhone|iPad|iPod/i.test(platform);
    withPlatform(platform, () => {
      for (const { event: shortcutEvent, expected } of cases) {
        expect(resolveFindAgainShortcut(event(shortcutEvent), isMac)).toBe(
          expected
        );
      }
    });
  }

  test('uses cmd+g / cmd+shift+g on macOS', () => {
    expectFindAgain('MacIntel', [
      { event: { key: 'g', metaKey: true }, expected: 'next' },
      {
        event: { key: 'g', metaKey: true, shiftKey: true },
        expected: 'previous',
      },
      { event: { key: 'g', ctrlKey: true }, expected: undefined },
    ]);
  });

  test('uses ctrl+g / ctrl+shift+g on windows and linux', () => {
    expectFindAgain('Linux x86_64', [
      { event: { key: 'g', ctrlKey: true }, expected: 'next' },
      {
        event: { key: 'g', ctrlKey: true, shiftKey: true },
        expected: 'previous',
      },
    ]);
  });

  test('ignores alt-modified and unmodified g', () => {
    expectFindAgain('MacIntel', [
      { event: { key: 'g', metaKey: true, altKey: true }, expected: undefined },
      { event: { key: 'g' }, expected: undefined },
      { event: { key: 'f', metaKey: true }, expected: undefined },
    ]);
  });
});
