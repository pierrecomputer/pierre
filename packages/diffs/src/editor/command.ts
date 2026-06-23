import { isMacLike, isPrimaryModifier } from './platform';

export type EditorCommand =
  | 'indent'
  | 'outdent'
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'findNextMatch'
  | 'openSearchPanel'
  | 'openSearchReplacePanel'
  | 'moveCursorToDocStart'
  | 'moveCursorToDocEnd'
  | 'expandSelectionDocStart'
  | 'expandSelectionDocEnd';

const SHORTCUTS: Partial<Record<string, EditorCommand>> = {
  a: 'selectAll',
  d: 'findNextMatch',
};

export function resolveEditorCommandFromKeyboardEvent(
  event: KeyboardEvent,
  isMac: boolean = isMacLike()
): EditorCommand | undefined {
  const hasPrimaryModifier = isPrimaryModifier(event, isMac);
  const { shiftKey, altKey, key } = event;

  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;

  // cmd/ctrl+f opens the search panel in find mode; adding alt opens it in
  // find/replace mode. macOS emits a dead key for Option+F (key === 'ƒ'), so
  // fall back to event.code to detect the physical F key.
  if (hasPrimaryModifier && (normalizedKey === 'f' || event.code === 'KeyF')) {
    return altKey ? 'openSearchReplacePanel' : 'openSearchPanel';
  }

  if (altKey) {
    return undefined;
  }

  if (!hasPrimaryModifier && normalizedKey === 'Tab') {
    return shiftKey ? 'outdent' : 'indent';
  }

  if (!hasPrimaryModifier) {
    return undefined;
  }

  if (normalizedKey === 'z') {
    return shiftKey ? 'redo' : 'undo';
  }

  if (!isMac && normalizedKey === 'y') {
    return 'redo';
  }

  if (normalizedKey === 'Home' || (isMac && normalizedKey === 'ArrowUp')) {
    if (shiftKey) {
      return 'expandSelectionDocStart';
    }
    return 'moveCursorToDocStart';
  }

  if (normalizedKey === 'End' || (isMac && normalizedKey === 'ArrowDown')) {
    if (shiftKey) {
      return 'expandSelectionDocEnd';
    }
    return 'moveCursorToDocEnd';
  }

  return SHORTCUTS[normalizedKey];
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
