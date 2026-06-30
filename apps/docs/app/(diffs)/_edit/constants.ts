import { DEFAULT_THEMES, type FileContents } from '@pierre/diffs';
import type { FileOptions } from '@pierre/diffs/react';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

// Options mirror the state the editor enforces when it attaches in
// `contentEditable` mode (token transformer on, gutter/line-selection/hover
// off). Baking them into the SSR preload makes the server HTML identical to the
// editor's post-attach render, so hydrating from `prerenderedHTML` doesn't
// flash or rerender. Mirrors LiveEditor/constants.ts.
const EDITABLE_FILE_OPTIONS: FileOptions<undefined> = {
  theme: DEFAULT_THEMES,
  themeType: 'dark',
  useTokenTransformer: true,
  enableGutterUtility: false,
  enableLineSelection: false,
  lineHoverHighlight: 'disabled',
};

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
    // so the marker must include char 0 for the popup to trigger.
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

// Keyboard-shortcut reference data. This is the single source of truth for the
// shortcuts section: the table renders by mapping over these groups, and the
// editor demo beside it shows this same data serialized back to source (see
// `serializeShortcutGroups`)—so the code on the left literally describes the
// table on the right.
export interface EditorShortcut {
  // Interchangeable main keys, shown joined by `/` (e.g. ['Home', 'End'] reads
  // as "Home / End"). A single entry renders as one key.
  keys: readonly string[];
  action: string;
  // Held modifier keys (e.g. ['Shift']) shown ahead of `keys` with no `/`, so
  // they read as pressed together rather than as alternatives.
  modifiers?: readonly string[];
  // When true, the row leads with the platform modifier: Cmd on macOS, Ctrl
  // elsewhere. Resolved client-side so one list reads correctly on every OS.
  mod?: boolean;
}

export interface EditorShortcutGroup {
  label: string;
  shortcuts: readonly EditorShortcut[];
}

export const EDITOR_SHORTCUT_GROUPS: readonly EditorShortcutGroup[] = [
  {
    label: 'Editing',
    shortcuts: [
      { keys: ['Tab'], action: 'Indent line or selection' },
      {
        keys: ['Tab'],
        modifiers: ['Shift'],
        action: 'Outdent line or selection',
      },
      { keys: ['X'], action: 'Cut', mod: true },
      { keys: ['C'], action: 'Copy', mod: true },
      { keys: ['V'], action: 'Paste', mod: true },
    ],
  },
  {
    label: 'Selection & cursor',
    shortcuts: [
      { keys: ['←', '→', '↑', '↓'], action: 'Move the cursor' },
      {
        keys: ['←', '→', '↑', '↓'],
        modifiers: ['Shift'],
        action: 'Extend the selection',
      },
      { keys: ['←', '→'], action: 'Jump to line start / end', mod: true },
      {
        keys: ['Home', 'End'],
        action: 'Jump to document start / end',
        mod: true,
      },
      { keys: ['A'], action: 'Select all', mod: true },
      { keys: ['Esc'], action: 'Collapse to a single cursor' },
    ],
  },
  {
    label: 'History',
    shortcuts: [
      { keys: ['Z'], action: 'Undo', mod: true },
      { keys: ['Z'], modifiers: ['Shift'], action: 'Redo', mod: true },
    ],
  },
  {
    label: 'Find',
    shortcuts: [
      { keys: ['F'], action: 'Open the search panel', mod: true },
      { keys: ['D'], action: 'Find next match of the selection', mod: true },
      { keys: ['G'], action: 'Next match', mod: true },
      {
        keys: ['G'],
        modifiers: ['Shift'],
        action: 'Previous match',
        mod: true,
      },
      { keys: ['Enter'], action: 'Next match (in search panel)' },
      { keys: ['Esc'], action: 'Close the search panel' },
    ],
  },
  {
    label: 'Multiple cursors',
    shortcuts: [
      { keys: ['Click'], action: 'Add a cursor at the click', mod: true },
    ],
  },
];

// Serialize the shortcut groups back to a readable `const shortcuts = [...]`
// source string. The editor demo renders this, so editing the data above keeps
// the on-screen code snippet and the rendered table perfectly in sync.
export function serializeShortcutGroups(
  groups: readonly EditorShortcutGroup[]
): string {
  const lines: string[] = [
    '// The data behind the table on the right—this very page maps over it.',
    "// Editing here won't rebuild the table, but go ahead: the surface is live.",
    '// `keys` are alternatives (joined by /); `modifiers` are held together.',
    '// `mod` adds the platform key: Cmd on macOS, Ctrl everywhere else.',
    'export const shortcuts = [',
  ];
  const literal = (values: readonly string[]) =>
    values.map((value) => `'${value}'`).join(', ');
  for (const group of groups) {
    lines.push(`  // ${group.label}`);
    for (const { keys, action, modifiers, mod } of group.shortcuts) {
      const parts = [`keys: [${literal(keys)}]`, `action: '${action}'`];
      if (modifiers != null) {
        parts.push(`modifiers: [${literal(modifiers)}]`);
      }
      if (mod === true) {
        parts.push('mod: true');
      }
      lines.push(`  { ${parts.join(', ')} },`);
    }
  }
  lines.push('];');
  return `${lines.join('\n')}\n`;
}

// The meta "code that built the table" surface. Its contents are generated from
// EDITOR_SHORTCUT_GROUPS so the snippet can never drift from the rendered table.
export const SHORTCUTS_DEMO_FILE: FileContents = {
  name: 'shortcuts.ts',
  contents: serializeShortcutGroups(EDITOR_SHORTCUT_GROUPS),
};

// Server-side preload inputs. Spreading the resolved results into <File> ships
// pre-rendered, already-highlighted shadow DOM so each demo paints instantly
// instead of flashing in after client highlighting.
export const MARKER_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: MARKER_DEMO_FILE,
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

export const SHORTCUTS_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: SHORTCUTS_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};

export const SELECTION_DEMO_FILE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: SELECTION_DEMO_FILE,
  options: EDITABLE_FILE_OPTIONS,
};
