import {
  type CodeViewItem,
  type FileContents,
  type FileDiffMetadata,
  parseDiffFromFile,
} from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

import type { PlaygroundUrlState } from './searchParams';
import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export interface PlaygroundAnnotationMetadata {
  key: string;
  isThread: boolean;
  body?: string;
}

// Multi-hunk diff: edits at top, middle (annotation on new line 25), and
// bottom. Unchanged blocks in the middle and at the end collapse so "Expand"
// shows hidden lines. ~15 modified lines; line 25 in new file is an addition.
const FILE_HEADER = `/**
 * User API – CRUD operations for user records.
 * @module api/users
 */

// ---

`;

const OLD_USERS_CONTENT = `${FILE_HEADER}import { db } from './database';
import { validateEmail } from './utils';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export async function getUser(id: string): Promise<User | null> {
  const user = await db.users.findUnique({
    where: { id },
  });
  return user;
}

export async function createUser(email: string, name: string): Promise<User> {
  if (!validateEmail(email)) {
    throw new Error('Invalid email');
  }

  const user = await db.users.create({
    data: {
      email,
      name,
      createdAt: new Date(),
    },
  });

  return user;
}

export async function deleteUser(id: string): Promise<void> {
  await db.users.delete({
    where: { id },
  });
}

`;

const NEW_USERS_CONTENT = `${FILE_HEADER}import { db } from './database';
import { validateEmail, hashPassword } from './utils';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export async function getUser(id: string): Promise<User | null> {
  const user = await db.users.findUnique({
    where: { id },
  });
  if (user === null) {
    throw new Error('User not found');
  }
  // validated
  return user;
}

export async function createUser(email: string, name: string): Promise<User> {
  if (!validateEmail(email)) {
    throw new Error('Invalid email address');
  }

  const user = await db.users.create({
    data: {
      email,
      name,
      createdAt: new Date(),
    },
  });

  return user;
}

export async function deleteUser(id: string): Promise<void> {
  await db.users.delete({
    where: { id },
  });
  // no-op if already deleted
}

`;

// Diagnostics for the playground's edit-mode marker toggle. Positions are
// zero-based line/character ranges into NEW_USERS_CONTENT (the diff's editable
// new-file side), so keep them in sync if that content changes. Severities are
// `as const` so the literals satisfy the editor's MarkerSeverity union without
// importing the Marker type (mirrors _edit/constants.ts MARKER_DEMO_MARKERS).
// Covers all four severities so the toggle exercises every marker color.
export const PLAYGROUND_MARKERS = [
  {
    severity: 'error' as const,
    source: 'ts',
    message: "Module './utils' has no exported member 'hashPassword'.",
    start: { line: 8, character: 24 },
    end: { line: 8, character: 36 },
  },
  {
    severity: 'info' as const,
    source: 'ts',
    message: "'user' is declared here; consider narrowing before use.",
    start: { line: 18, character: 8 },
    end: { line: 18, character: 12 },
  },
  {
    severity: 'warning' as const,
    source: 'eslint',
    message: 'Prefer a custom error subclass over the generic Error.',
    start: { line: 22, character: 14 },
    end: { line: 22, character: 19 },
  },
  {
    severity: 'hint' as const,
    source: 'eslint',
    message: 'Redundant comment; the guard above already documents this.',
    start: { line: 24, character: 2 },
    end: { line: 24, character: 14 },
  },
];

export const PLAYGROUND_FILE: FileContents = {
  name: 'api/users.ts',
  contents: NEW_USERS_CONTENT,
};

const PLAYGROUND_FILE_DIFF = parseDiffFromFile(
  {
    name: 'api/users.ts',
    contents: OLD_USERS_CONTENT,
  },
  PLAYGROUND_FILE
);

const PLAYGROUND_ANNOTATIONS = [
  {
    side: 'additions',
    lineNumber: 25,
    metadata: {
      key: 'additions-25',
      isThread: true,
    },
  },
] satisfies PreloadFileDiffOptions<PlaygroundAnnotationMetadata>['annotations'];

// Maps the shared URL state onto the preload options, so the prerendered
// markup matches what the client derives from the same querystring — the
// markup paints before hydration, and a drifted option would show the
// server's presentation until the first client repaint. `colorMode` maps to
// themeType directly: 'system' ships both themes and resolves via the native
// CSS `light-dark()` against the pre-paint color-scheme, so no flash when
// the client theme controller settles.
export function getPlaygroundPreloadOptions(
  state: PlaygroundUrlState
): PreloadFileDiffOptions<PlaygroundAnnotationMetadata> {
  return {
    fileDiff: PLAYGROUND_FILE_DIFF,
    options: {
      theme: { dark: state.darkTheme, light: state.lightTheme },
      themeType: state.colorMode,
      diffStyle: state.diffStyle,
      overflow: state.overflow,
      diffIndicators: state.diffIndicators,
      lineDiffType: state.lineDiffType,
      hunkSeparators: state.hunkSeparators,
      disableBackground: state.disableBackground,
      disableLineNumbers: state.disableLineNumbers,
      unsafeCSS: CustomScrollbarCSS,
    },
    annotations: state.showAnnotations ? PLAYGROUND_ANNOTATIONS : [],
  };
}

// -----------------------------------------------------------------------------
// Multi-item fixtures for the Virtualizer and CodeView playground modes.
//
// Every diff below is built with `parseDiffFromFile` from complete old/new file
// contents, so they are full (non-partial) diffs. Partial diffs (e.g. from
// `parsePatchFiles`) would need a `loadDiffFiles` loader to hydrate, which these
// demo surfaces intentionally avoid.
// -----------------------------------------------------------------------------

const OLD_STYLES_CONTENT = `.button {
  padding: 8px 12px;
  border-radius: 4px;
  background: #3b82f6;
  color: #ffffff;
}

.button:hover {
  background: #2563eb;
}

.card {
  border: 1px solid #e5e7eb;
  padding: 16px;
}
`;

const NEW_STYLES_CONTENT = `.button {
  padding: 10px 16px;
  border-radius: 8px;
  background: #6366f1;
  color: #ffffff;
  font-weight: 600;
}

.button:hover {
  background: #4f46e5;
  transform: translateY(-1px);
}

.card {
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
`;

const OLD_README_CONTENT = `# users API

Basic CRUD helpers for user records.

- getUser
- createUser
- deleteUser
`;

const NEW_README_CONTENT = `# Users API

CRUD helpers for user records, backed by the shared database client.

## API

- \`getUser(id)\` – fetch a single user, throws when missing
- \`createUser(email, name)\` – validates the email before insert
- \`deleteUser(id)\` – idempotent delete

## Usage

\`\`\`ts
import { getUser } from './api/users';

const user = await getUser('123');
\`\`\`
`;

// The plain-file items ship the README repeated 10x so the file surfaces are
// long enough to scroll on their own. Only the file items use this — the diff
// fixtures keep their authored sizes (one long fixture plus the shorter
// variants).
const LONG_README_CONTENT = NEW_README_CONTENT.repeat(10);

// The long README as a ready-made plain file: leads the CodeView items and
// both Virtualizer lists. FileContents is never mutated by the library, so
// one shared instance is fine across surfaces.
export const LONG_README_FILE: FileContents = {
  name: 'README.md',
  contents: LONG_README_CONTENT,
};

// Nested markup with meaningful indentation, for exercising edit-mode diff
// alignment: wrapping/unwrapping containers, pushing lines around with
// Enter, and re-indenting all reshape change blocks whose lines differ only
// (or mostly) in whitespace. The unchanged middle keeps a collapsible gap
// between the changed regions.
const OLD_MARKUP_CONTENT = `<section class="profile">
  <header class="profile-header">
    <div class="avatar-wrap">
      <img src="/avatars/ada.png" alt="Ada Lovelace" />
    </div>
    <h2 class="profile-name">Ada Lovelace</h2>
  </header>
  <div class="profile-body">
    <p class="bio">Mathematician and writer.</p>
    <ul class="links">
      <li>
        <a href="/notes">Notes</a>
      </li>
      <li>
        <a href="/programs">Programs</a>
      </li>
      <li>
        <a href="/letters">Letters</a>
      </li>
    </ul>
    <div class="stats">
      <span class="stat">12 notes</span>
      <span class="stat">3 programs</span>
    </div>
  </div>
  <footer class="profile-footer">
    <button class="follow">Follow</button>
  </footer>
</section>
`;

const NEW_MARKUP_CONTENT = `<section class="profile profile--wide">
  <header class="profile-header">
    <img src="/avatars/ada.png" alt="Ada Lovelace" />
    <h2 class="profile-name">Ada Lovelace</h2>
  </header>
  <div class="profile-body">
    <p class="bio">Mathematician and writer.</p>
    <ul class="links">
      <li>
        <a href="/notes">Notes</a>
      </li>
      <li>
        <a href="/programs">Programs</a>
      </li>
      <li>
        <a href="/letters">Letters</a>
      </li>
    </ul>
    <div class="stats">
      <span class="stat">12 notes</span>
      <span class="stat">3 programs</span>
    </div>
  </div>
  <footer class="profile-footer">
    <button class="follow" type="button">Follow</button>
  </footer>
</section>
`;

// The base files are replicated into several uniquely-named variants so the
// Virtualizer and CodeView demos have enough content to scroll through. Each
// variant is a full (non-partial) diff parsed from complete old/new contents.
const DIFF_VARIANT_COUNT = 4;

interface BaseDiff {
  name: string;
  oldContents: string;
  newContents: string;
}

const USERS_BASE: BaseDiff = {
  name: 'api/users.ts',
  oldContents: OLD_USERS_CONTENT,
  newContents: NEW_USERS_CONTENT,
};

const STYLES_BASE: BaseDiff = {
  name: 'ui/button.css',
  oldContents: OLD_STYLES_CONTENT,
  newContents: NEW_STYLES_CONTENT,
};

const README_BASE: BaseDiff = {
  name: 'README.md',
  oldContents: OLD_README_CONTENT,
  newContents: NEW_README_CONTENT,
};

const MARKUP_BASE: BaseDiff = {
  name: 'ui/profile-card.html',
  oldContents: OLD_MARKUP_CONTENT,
  newContents: NEW_MARKUP_CONTENT,
};

const BASE_DIFFS: BaseDiff[] = [
  USERS_BASE,
  MARKUP_BASE,
  STYLES_BASE,
  README_BASE,
];

// Appends a variant index before the file extension (e.g. `users.ts` ->
// `users-2.ts`) so each replicated file has a distinct name and id.
function variantName(name: string, index: number): string {
  if (index === 0) {
    return name;
  }
  const dot = name.lastIndexOf('.');
  return dot === -1
    ? `${name}-${index}`
    : `${name.slice(0, dot)}-${index}${name.slice(dot)}`;
}

function variantDiff(base: BaseDiff, index: number): FileDiffMetadata {
  const name = variantName(base.name, index);
  return parseDiffFromFile(
    { name, contents: base.oldContents },
    { name, contents: base.newContents }
  );
}

// -----------------------------------------------------------------------------
// Long single-file fixture
//
// One diff tall enough to scroll through on its own: a generated "resource
// registry" module with a get/list helper pair per table. Edits land in every
// pair, so the rendered diff stays fully expanded (no collapsed unchanged
// regions) and runs 600+ rows top to bottom.
// -----------------------------------------------------------------------------

const LONG_FIXTURE_NAME = 'api/resources.ts';

// Each table yields a ~14-line (old) / ~18-line (new) helper pair; 30 tables
// keep the generated file past 500 lines. Every name pluralizes with a bare
// `s`, which is how the table accessor and list-helper names are derived.
const LONG_FIXTURE_TABLES = [
  'account',
  'project',
  'repo',
  'commit',
  'issue',
  'comment',
  'label',
  'milestone',
  'review',
  'deployment',
  'webhook',
  'token',
  'session',
  'team',
  'invite',
  'notification',
  'tag',
  'release',
  'artifact',
  'pipeline',
  'job',
  'runner',
  'secret',
  'environment',
  'alert',
  'dashboard',
  'report',
  'audit',
  'changelog',
  'snapshot',
];

// Builds the old/new contents of the long fixture. The new side rewrites each
// helper pair — `get*` gains a missing-record throw (and drops `| null`),
// `list*` gains a default limit and an `orderBy` — so a change lands at least
// every ~6 lines. With the widened diff context in `longFixtureDiff`, that
// density keeps the whole file in a single hunk with every line visible.
function buildLongFixtureContents(): {
  oldContents: string;
  newContents: string;
} {
  const oldLines: string[] = [
    '/**',
    ' * Resource registry – CRUD helpers for every synced table.',
    ' * @module api/resources',
    ' */',
    '',
    "import { db } from './database';",
    '',
    'export interface Resource {',
    '  id: string;',
    '  createdAt: Date;',
    '}',
    '',
  ];
  const newLines: string[] = [
    '/**',
    ' * Resource registry – CRUD helpers for every synced table.',
    ' * @module api/resources',
    ' */',
    '',
    "import { db } from './database';",
    "import { NotFoundError } from './errors';",
    '',
    'export interface Resource {',
    '  id: string;',
    '  createdAt: Date;',
    '  updatedAt: Date;',
    '}',
    '',
  ];

  LONG_FIXTURE_TABLES.forEach((table, index) => {
    const single = table.charAt(0).toUpperCase() + table.slice(1);
    const plural = `${table}s`;
    const defaultLimit = 20 + (index % 4) * 10;

    oldLines.push(
      `/** CRUD helpers for the \`${plural}\` table. */`,
      `export async function get${single}(id: string): Promise<Resource | null> {`,
      `  const record = await db.${plural}.findUnique({`,
      '    where: { id },',
      '  });',
      '  return record;',
      '}',
      '',
      `export async function list${single}s(limit: number): Promise<Resource[]> {`,
      `  return db.${plural}.findMany({`,
      '    take: limit,',
      '  });',
      '}',
      ''
    );
    newLines.push(
      `/** CRUD helpers for the \`${plural}\` table. */`,
      `export async function get${single}(id: string): Promise<Resource> {`,
      `  const record = await db.${plural}.findUnique({`,
      '    where: { id },',
      '  });',
      '  if (record === null) {',
      `    throw new NotFoundError('${table}', id);`,
      '  }',
      '  return record;',
      '}',
      '',
      `export async function list${single}s(limit = ${defaultLimit}): Promise<Resource[]> {`,
      `  return db.${plural}.findMany({`,
      '    take: limit,',
      "    orderBy: { createdAt: 'desc' },",
      '  });',
      '}',
      ''
    );
  });

  return {
    oldContents: oldLines.join('\n'),
    newContents: newLines.join('\n'),
  };
}

const LONG_FIXTURE_CONTENTS = buildLongFixtureContents();

// Fresh parse per call so each surface (Virtualizer list, CodeView items) gets
// its own FileDiffMetadata instance, matching how `variantDiff` builds the
// replicated fixtures. `context: 8` widens jsdiff's default of 4 so the added
// import near the top keeps line 1 inside the first hunk instead of leaving a
// two-line collapsed region above it.
function longFixtureDiff(): FileDiffMetadata {
  return parseDiffFromFile(
    { name: LONG_FIXTURE_NAME, contents: LONG_FIXTURE_CONTENTS.oldContents },
    { name: LONG_FIXTURE_NAME, contents: LONG_FIXTURE_CONTENTS.newContents },
    { context: 8 }
  );
}

// Diffs rendered as a list in the Virtualizer (window/body scroll) mode. The
// long single-file fixture leads so scroll-heavy behavior inside one file is
// reachable without paging through the shorter variants first.
export const VIRTUALIZER_FILE_DIFFS: FileDiffMetadata[] = [
  longFixtureDiff(),
  ...Array.from({ length: DIFF_VARIANT_COUNT }, (_, index) =>
    BASE_DIFFS.map((base) => variantDiff(base, index))
  ).flat(),
];

// Items rendered in the CodeView mode: the long README file item leads,
// followed by the long single-file diff (as in the Virtualizer list), then
// each variant contributes two diffs and a plain file so the demo shows both
// item types scrolling within CodeView's own scroll container.
export const CODE_VIEW_ITEMS: CodeViewItem<PlaygroundAnnotationMetadata>[] = [
  {
    id: 'file:README.md',
    type: 'file',
    file: LONG_README_FILE,
  },
  {
    id: `diff:${LONG_FIXTURE_NAME}`,
    type: 'diff',
    fileDiff: longFixtureDiff(),
  },
  ...Array.from(
    { length: DIFF_VARIANT_COUNT },
    (_, index): CodeViewItem<PlaygroundAnnotationMetadata>[] => {
      const readmeName = variantName('README.md', index);
      // Variant 0's README file is hoisted to the head of the list above, so
      // only the later variants emit a file item here.
      const readmeItems: CodeViewItem<PlaygroundAnnotationMetadata>[] =
        index === 0
          ? []
          : [
              {
                id: `file:${readmeName}`,
                type: 'file',
                file: { name: readmeName, contents: LONG_README_CONTENT },
              },
            ];
      return [
        {
          id: `diff:${variantName(USERS_BASE.name, index)}`,
          type: 'diff',
          fileDiff: variantDiff(USERS_BASE, index),
        },
        {
          id: `diff:${variantName(MARKUP_BASE.name, index)}`,
          type: 'diff',
          fileDiff: variantDiff(MARKUP_BASE, index),
        },
        ...readmeItems,
        {
          id: `diff:${variantName(STYLES_BASE.name, index)}`,
          type: 'diff',
          fileDiff: variantDiff(STYLES_BASE, index),
        },
      ];
    }
  ).flat(),
];

export const ITEM_UNSAFE_CSS = `${CustomScrollbarCSS}
[data-diffs-header] {
  box-shadow: 0 -1px 0 var(--color-border);
}

[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
}

@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}
`;
