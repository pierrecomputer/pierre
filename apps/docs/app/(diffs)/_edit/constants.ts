import {
  DEFAULT_THEMES,
  type EditorCaret,
  type FileContents,
} from '@pierre/diffs';
import type { EditorCommand, EditorKeymap } from '@pierre/diffs/edit';
import type { FileOptions } from '@pierre/diffs/react';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

// The editor requires the token transformer, so enabling it in the SSR preload
// keeps hydration from rerendering the component after the editor attaches.
// Mirrors LiveEditing/constants.ts.
const EDITABLE_FILE_OPTIONS: FileOptions<undefined> = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  useTokenTransformer: true,
};

export interface CursorCaretMetadata {
  name: string;
  color: string;
}

export const CARET_DEMO_FILE: FileContents = {
  name: 'review.ts',
  contents: `type Review = {
  author: string
  approved: boolean
}

export function summarize(review: Review) {
  const status = review.approved ? 'approved' : 'needs review'
  return \`\${review.author}: \${status}\`
}
`,
};

export const CARET_DEMO_CARETS: EditorCaret<CursorCaretMetadata>[] = [
  {
    position: { line: 5, character: 26 },
    metadata: { name: 'Amadeus', color: '#7c3aed' },
  },
  {
    position: { line: 1, character: 8 },
    highlight: {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 8 },
    },
    highlightColor: 'color-mix(in srgb, #c2410c 32%, transparent)',
    metadata: { name: 'Mark', color: '#c2410c' },
  },
];

// Lint-marker demo source. Marker positions below are tied to these exact
// lines, so keep the two in sync if the contents change.
export const MARKER_DEMO_FILE: FileContents = {
  name: 'totals.ts',
  contents: `// TODO: validate items and taxRate before summing
function calculateTotal(items, taxRate) {
  var total = 0
  for (var i = 0; i < items.length; i++) {
    total += items[i].price
  }

  let tax = total * taxRate
  console.log('subtotal', total)

  if (total == 0) {
    return null
  }

  return {
    subtotal: total,
    tax,
    grandTotal: total + tax,
  }
}
`,
};

// Diagnostics a real linter might produce for MARKER_DEMO_FILE. Positions are
// zero-based line/character ranges. Severities are `as const` so the literals
// satisfy the editor's MarkerSeverity union without importing the (not yet
// exported) Marker type.
export const MARKER_DEMO_MARKERS = [
  {
    severity: 'hint' as const,
    source: 'todo',
    message: 'Unresolved TODO comment',
    // Spans the whole comment: hover detection keys off the hovered token's
    // start column, and the line comment is a single token starting at char 0,
    // so the marker must include char 0 for the popover to trigger.
    start: { line: 0, character: 0 },
    end: { line: 0, character: 50 },
  },
  {
    severity: 'warning' as const,
    source: 'eslint',
    message: 'Unexpected var, use let or const instead.',
    start: { line: 2, character: 2 },
    end: { line: 2, character: 5 },
  },
  {
    severity: 'warning' as const,
    source: 'eslint',
    message: 'Unexpected var, use let or const instead',
    start: { line: 3, character: 7 },
    end: { line: 3, character: 10 },
  },
  {
    severity: 'info' as const,
    source: 'ts',
    message: "Object is possibly 'undefined'",
    start: { line: 4, character: 13 },
    end: { line: 4, character: 21 },
  },
  {
    severity: 'warning' as const,
    source: 'eslint',
    message: "'tax' is never reassigned. Use 'const' instead",
    start: { line: 7, character: 6 },
    end: { line: 7, character: 9 },
  },
  {
    severity: 'info' as const,
    source: 'eslint',
    message: 'Unexpected console statement',
    start: { line: 8, character: 2 },
    end: { line: 8, character: 13 },
  },
  {
    severity: 'error' as const,
    source: 'eslint',
    message: 'Expected === and instead saw ==',
    start: { line: 10, character: 12 },
    end: { line: 10, character: 14 },
  },
];

// Find-in-file demo source: several "user" occurrences (case-insensitively) so
// typing a query like "user" surfaces multiple matches to navigate between.
export const FIND_DEMO_FILE: FileContents = {
  name: 'user.ts',
  contents: `type User = {
  id: string;
  name: string;
  email: string;
};

function formatUser(user: User) {
  const name = user.name.trim();
  const email = user.email.toLowerCase();
  return { id: user.id, name, email };
}

export function getUsers(users: User[]) {
  return users.map(formatUser);
}
`,
};

// Selection-action demo source: a small banner module with inline string
// literals that read as good candidates for a selection-scoped transform (wrap
// for translation, shout in caps), so running the action on one is meaningful.
export const SELECTION_DEMO_FILE: FileContents = {
  name: 'banner.ts',
  contents: `const greeting = 'Welcome back'
const farewell = 'See you soon'
const errorText = 'Something went wrong'

type Banner = { title: string; tone: 'info' | 'error' }

function renderBanner(name: string): Banner {
  const title = greeting + ', ' + name + '!'
  return { title, tone: 'info' }
}

function renderError(): Banner {
  return { title: errorText, tone: 'error' }
}

function renderFooter(year: number) {
  return farewell + ' · © ' + year
}
`,
};

// History demo source: a small, untyped cart calculator that the demo
// modernizes one edit at a time.
export const HISTORY_DEMO_FILE: FileContents = {
  name: 'cart.ts',
  contents: `function calculateCart(items) {
  var total = 0
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].price * items[i].qty
  }

  var discount = 0
  if (total > 100) {
    discount = total * 0.1
  }

  var shipping = 5
  if (total > 50) {
    shipping = 0
  }

  return total - discount + shipping
}
`,
};

// A single seeded edit: replace `find` with `replace`; `label` names the step
// in the history list. Edits replay in array order, each `find` unique in the
// document when applied (later edits may anchor on text earlier ones added), and
// each produces one discrete, non-coalescing entry on the undo stack.
export interface HistoryDemoEdit {
  find: string;
  replace: string;
  label: string;
}

// The refactor, told as seven discrete steps that fold the loops and var
// declarations into typed, modern equivalents. Several touch multiple lines so
// undoing/redoing a step is visually obvious.
export const HISTORY_DEMO_EDITS: readonly HistoryDemoEdit[] = [
  {
    find: 'function calculateCart(items) {',
    replace: 'function calculateCart(items: CartItem[]): number {',
    label: 'Type the signature',
  },
  {
    find: 'function calculateCart(items: CartItem[]): number {',
    replace:
      'type CartItem = { price: number; qty: number }\n\nfunction calculateCart(items: CartItem[]): number {',
    label: 'Declare the CartItem type',
  },
  {
    find: `  var total = 0
  for (var i = 0; i < items.length; i++) {
    total = total + items[i].price * items[i].qty
  }`,
    replace: `  const total = items.reduce(
    (sum, item) => sum + item.price * item.qty,
    0,
  )`,
    label: 'Sum items with reduce',
  },
  {
    find: `  var discount = 0
  if (total > 100) {
    discount = total * 0.1
  }`,
    replace: '  const discount = total > 100 ? total * 0.1 : 0',
    label: 'Inline the discount',
  },
  {
    find: `  var shipping = 5
  if (total > 50) {
    shipping = 0
  }`,
    replace: '  const shipping = total > 50 ? 0 : 5',
    label: 'Inline the shipping',
  },
  {
    find: '  return total - discount + shipping',
    replace:
      '  const tax = (total - discount) * 0.08\n  return total - discount + shipping + tax',
    label: 'Add sales tax',
  },
  {
    find: '  return total - discount + shipping + tax',
    replace:
      '  return Math.round((total - discount + shipping + tax) * 100) / 100',
    label: 'Round to cents',
  },
];

export const EDITOR_COMMAND_LABELS = {
  indent: 'Indent line or selection',
  outdent: 'Outdent line or selection',
  indentLess: 'Decrease indentation',
  indentMore: 'Increase indentation',
  undo: 'Undo',
  redo: 'Redo',
  selectAll: 'Select all',
  findNextMatch: 'Find next match of the selection',
  openSearchPanel: 'Open search',
  openSearchReplacePanel: 'Open search and replace',
  moveLineUp: 'Move selected line(s) up',
  moveLineDown: 'Move selected line(s) down',
  copyLineUp: 'Copy selected line(s) up',
  copyLineDown: 'Copy selected line(s) down',
  simplifySelection: 'Collapse to a single cursor',
  insertBlankLine: 'Insert a blank line',
  deleteHardLineForward: 'Delete to the end of the line',
  toggleComment: 'Toggle line comment',
  toggleBlockComment: 'Toggle block comment',
  moveCursorToDocStart: 'Move cursor to document start',
  moveCursorToDocEnd: 'Move cursor to document end',
  expandSelectionDocStart: 'Extend selection to document start',
  expandSelectionDocEnd: 'Extend selection to document end',
} satisfies Record<EditorCommand, string>;

// Docs-local mirror of the private default keymap in editor/command.ts. The
// searchable list and editable JSON both derive from this exact value.
export const DEFAULT_EDITOR_KEYMAP: EditorKeymap = [
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
    platform: 'linux',
    bindings: {
      'ctrl+y': 'redo',
      'ctrl+alt+p': 'moveLineUp',
      'ctrl+alt+n': 'moveLineDown',
    },
  },
  {
    platform: 'windows',
    bindings: {
      'ctrl+y': 'redo',
    },
  },
];

const DEFAULT_KEYMAP_FILE: FileContents = {
  name: 'keymap.json',
  contents: `${JSON.stringify(DEFAULT_EDITOR_KEYMAP, null, 2)}\n`,
};

// Server-side preload inputs. Spreading the resolved results into <File> ships
// pre-rendered, already-highlighted shadow DOM so each demo paints instantly
// instead of flashing in after client highlighting.
export const MARKER_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: MARKER_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};

export const CARET_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: CARET_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};

export const FIND_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: FIND_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};

export const HISTORY_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: HISTORY_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};

export const DEFAULT_KEYMAP_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: DEFAULT_KEYMAP_FILE,
  options: { ...EDITABLE_FILE_OPTIONS, disableFileHeader: true },
};

export const SELECTION_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: SELECTION_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};
