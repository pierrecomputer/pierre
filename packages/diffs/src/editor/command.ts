import { isMacLike, isPrimaryModifier } from './platform';

export type EditorCommand =
  | 'indent'
  | 'outdent'
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'findNextMatch'
  | 'openSearchPanel'
  | 'moveCursorToDocStart'
  | 'moveCursorToDocEnd'
  | 'expandSelectionDocStart'
  | 'expandSelectionDocEnd';

const SHORTCUTS: Partial<Record<string, EditorCommand>> = {
  a: 'selectAll',
  d: 'findNextMatch',
  f: 'openSearchPanel',
};

export function resolveEditorCommandFromKeyboardEvent(
  event: KeyboardEvent,
  isMac: boolean = isMacLike()
): EditorCommand | undefined {
  const hasPrimaryModifier = isPrimaryModifier(event, isMac);
  const { shiftKey, altKey, key } = event;
  if (altKey) {
    return undefined;
  }

  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;

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
