import { isMacLike, isPrimaryModifier } from './platform';

export type EditorCommand =
  | 'indent'
  | 'outdent'
  | 'indentLess'
  | 'indentMore'
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'findNextMatch'
  | 'openSearchPanel'
  | 'openSearchReplacePanel'
  | 'moveLineUp'
  | 'moveLineDown'
  | 'copyLineUp'
  | 'copyLineDown'
  | 'simplifySelection'
  | 'insertBlankLine'
  | 'deleteHardLineForward'
  | 'toggleComment'
  | 'toggleBlockComment'
  | 'moveCursorToDocStart'
  | 'moveCursorToDocEnd'
  | 'expandSelectionDocStart'
  | 'expandSelectionDocEnd';

export type KeyboardKey =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '`'
  | '-'
  | '='
  | ','
  | '.'
  | '/'
  | ';'
  | "'"
  | '['
  | ']'
  | '\\'
  | 'Space'
  | 'Tab'
  | 'Enter'
  | 'Escape'
  | 'Backspace'
  | 'Delete'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'F1'
  | 'F2'
  | 'F3'
  | 'F4'
  | 'F5'
  | 'F6'
  | 'F7'
  | 'F8'
  | 'F9'
  | 'F10'
  | 'F11'
  | 'F12';

export type KeyboardModifier = 'cmdOrCtrl' | 'shift' | 'alt' | 'ctrl' | 'cmd';

export type EditorShortcut =
  | KeyboardKey
  | `${KeyboardModifier}+${KeyboardKey}`
  | `${KeyboardModifier}+${KeyboardModifier}+${KeyboardKey}`;

const editorPlatforms = ['mac', 'windows', 'linux'] as const;
type EditorPlatform = (typeof editorPlatforms)[number];

/** Later groups take precedence when bindings overlap. */
export type EditorKeymap = ReadonlyArray<{
  /** Undefined applies on every platform. */
  readonly platform?: EditorPlatform;
  readonly bindings: Readonly<Partial<Record<EditorShortcut, EditorCommand>>>;
}>;

type CompiledEditorKeymap = Record<
  EditorPlatform,
  Map<number, Map<KeyboardKey, EditorCommand>>
>;

const compiledEditorKeymaps = new WeakMap<EditorKeymap, CompiledEditorKeymap>();

const defaultKeymap = [
  {
    bindings: {
      Tab: 'indent',
      'shift+Tab': 'outdent',
      'cmdOrCtrl+[': 'indentLess',
      'cmdOrCtrl+]': 'indentMore',
      'cmdOrCtrl+z': 'undo',
      'cmdOrCtrl+shift+z': 'redo',
      'cmdOrCtrl+a': 'selectAll',
      'cmdOrCtrl+d': 'findNextMatch',
      'cmdOrCtrl+f': 'openSearchPanel',
      'cmdOrCtrl+alt+f': 'openSearchReplacePanel',
      'alt+ArrowUp': 'moveLineUp',
      'alt+ArrowDown': 'moveLineDown',
      'shift+alt+ArrowUp': 'copyLineUp',
      'shift+alt+ArrowDown': 'copyLineDown',
      Escape: 'simplifySelection',
      'cmdOrCtrl+Enter': 'insertBlankLine',
      'cmdOrCtrl+/': 'toggleComment',
      'shift+alt+a': 'toggleBlockComment',
      'cmdOrCtrl+Home': 'moveCursorToDocStart',
      'cmdOrCtrl+End': 'moveCursorToDocEnd',
      'cmdOrCtrl+shift+Home': 'expandSelectionDocStart',
      'cmdOrCtrl+shift+End': 'expandSelectionDocEnd',
    },
  },
  {
    platform: 'mac',
    bindings: {
      'ctrl+k': 'deleteHardLineForward',
      'ctrl+alt+p': 'moveLineUp',
      'ctrl+alt+n': 'moveLineDown',
      'cmd+ArrowUp': 'moveCursorToDocStart',
      'cmd+ArrowDown': 'moveCursorToDocEnd',
      'cmd+shift+ArrowUp': 'expandSelectionDocStart',
      'cmd+shift+ArrowDown': 'expandSelectionDocEnd',
    },
  },
  {
    platform: 'windows',
    bindings: {
      'ctrl+y': 'redo',
    },
  },
  {
    platform: 'linux',
    bindings: {
      'ctrl+y': 'redo',
      'ctrl+alt+p': 'moveLineUp',
      'ctrl+alt+n': 'moveLineDown',
    },
  },
] satisfies EditorKeymap;

const keyboardCodeKeys: Partial<Record<string, KeyboardKey>> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Space: 'Space',
};

function getCompiledEditorKeymap(keymap: EditorKeymap): CompiledEditorKeymap {
  let compiledKeymap = compiledEditorKeymaps.get(keymap);
  if (compiledKeymap === undefined) {
    compiledKeymap = {
      mac: new Map(),
      windows: new Map(),
      linux: new Map(),
    };

    // Compile once so keydown resolves by modifier mask and key without
    // scanning or splitting every configured shortcut.
    for (const entry of keymap) {
      for (const shortcut of Object.keys(entry.bindings) as EditorShortcut[]) {
        const command = entry.bindings[shortcut];
        if (command === undefined) {
          continue;
        }
        const parts = shortcut.split('+');
        const shortcutKey = parts.pop() as KeyboardKey;

        for (const platform of editorPlatforms) {
          if (entry.platform !== undefined && entry.platform !== platform) {
            continue;
          }
          let modifiers = 0;
          for (const modifier of parts as KeyboardModifier[]) {
            if (modifier === 'alt') {
              modifiers |= 1;
            } else if (modifier === 'ctrl') {
              modifiers |= 2;
            } else if (modifier === 'cmd') {
              modifiers |= 4;
            } else if (modifier === 'shift') {
              modifiers |= 8;
            } else if (modifier === 'cmdOrCtrl') {
              modifiers |= platform === 'mac' ? 4 : 2;
            }
          }
          let bindings = compiledKeymap[platform].get(modifiers);
          if (bindings === undefined) {
            bindings = new Map();
            compiledKeymap[platform].set(modifiers, bindings);
          }
          bindings.set(shortcutKey, command);
        }
      }
    }
    compiledEditorKeymaps.set(keymap, compiledKeymap);
  }
  return compiledKeymap;
}

const compiledDefaultKeymap = getCompiledEditorKeymap(defaultKeymap);

export function resolveEditorCommandFromKeyboardEvent(
  event: KeyboardEvent,
  keymap?: EditorKeymap,
  isMac: boolean = isMacLike()
): EditorCommand | undefined {
  const eventKey =
    event.key === ' '
      ? 'Space'
      : event.key.length === 1
        ? event.key.toLowerCase()
        : event.key;
  const code = event.code ?? '';
  const codeKey =
    code.startsWith('Key') && code.length === 4
      ? (code.slice(3).toLowerCase() as KeyboardKey)
      : code.startsWith('Digit') && code.length === 6
        ? (code.slice(5) as KeyboardKey)
        : keyboardCodeKeys[code];
  const platform = isMac
    ? 'mac'
    : globalThis.navigator?.platform.includes('Linux') === true
      ? 'linux'
      : 'windows';
  const modifiers =
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0);

  if (keymap !== undefined) {
    const bindings = getCompiledEditorKeymap(keymap)[platform].get(modifiers);
    const command =
      bindings?.get(eventKey as KeyboardKey) ??
      (codeKey === undefined ? undefined : bindings?.get(codeKey));
    if (command !== undefined) {
      return command;
    }
  }

  const bindings = compiledDefaultKeymap[platform].get(modifiers);
  return (
    bindings?.get(eventKey as KeyboardKey) ??
    (codeKey === undefined ? undefined : bindings?.get(codeKey))
  );
}

// Detects the native "find again" shortcut (cmd/ctrl+g for next, adding shift
// for previous) so the find/replace panel can override the browser default and
// step through matches. macOS can emit a dead key for the physical G, so fall
// back to event.code like the cmd+f handling above.
export function resolveFindAgainShortcut(
  event: KeyboardEvent,
  isMac: boolean = isMacLike()
): 'next' | 'previous' | undefined {
  if (event.altKey) {
    return undefined;
  }
  if (!isPrimaryModifier(event, isMac)) {
    return undefined;
  }
  const normalizedKey =
    event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (normalizedKey === 'g' || event.code === 'KeyG') {
    return event.shiftKey ? 'previous' : 'next';
  }
  return undefined;
}
