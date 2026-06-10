// Build-time guard: asserts that the core @pierre/theming entry point
// (dist/index.js and every file it transitively imports) does not pull in
// Shiki, @pierre/theme, React, Preact, DOM APIs, or tokenColors.
//
// We walk the import graph starting from dist/index.js rather than using an
// explicit allowlist because the graph walk automatically tracks any file the
// core actually bundles, including new core helpers added in the future, while
// naturally excluding the /themes and /react entry trees which
// index.js does not import.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Forbidden external module specifiers stored WITHOUT trailing slashes.
// A specifier is forbidden when it exactly matches an entry OR when it starts
// with `entry + "/"`. This correctly catches scoped-package sub-paths such as
// `@shikijs/core` (matched by the `@shikijs` entry) while avoiding false
// matches — e.g. `react` does not match `react-dom` because `react-dom` does
// not equal `react` and does not start with `react/`.
const FORBIDDEN_MODULES = [
  'shiki',
  '@shikijs',
  '@pierre/theme',
  'react',
  'react-dom',
  'preact',
];

// Forbidden bare identifiers that must not appear in core runtime code.
// DOM globals `document` and `window` indicate unintentional DOM coupling.
// `tokenColors` indicates Shiki/VS Code theme data leaked into the core.
const FORBIDDEN_IDENTIFIERS = ['document', 'window', 'tokenColors'];

// Matches quoted static import specifiers: from "x", import("x"), import "x".
// Group 1 holds the specifier string (without quotes).
const QUOTED_IMPORT_RE =
  /(?:from\s+|import\s*\(|import\s+)\s*["']([^"']+)["']/g;

// Matches template-literal dynamic imports: import(`<prefix>${...}`) or
// import(`<static-only>`). Group 1 holds the static text before the first
// "${" (or the entire string if there is no interpolation).
// We treat the static prefix as the specifier so that
//   import(`shiki/themes/${name}.mjs`)  →  "shiki/themes/"
//   import(`@pierre/theme/${name}`)     →  "@pierre/theme/"
// Both are then caught by the forbidden-module startsWith check.
const TEMPLATE_IMPORT_RE = /import\s*\(\s*`([^`$]*)/g;

// Extract every import specifier visible in `src` (comment-stripped JS source).
// Returns specifiers from:
//   - static imports:       from '...' / import '...' / import("...")
//   - template-literal dynamic imports: the static prefix before any ${...}
// Relative specifiers (starting with "./" or "../") are included — callers
// that want only external specifiers must filter them out.
export function extractImportSpecifiers(src: string): string[] {
  const specs: string[] = [];

  QUOTED_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = QUOTED_IMPORT_RE.exec(src)) !== null) {
    if (match[1] !== undefined) specs.push(match[1]);
  }

  TEMPLATE_IMPORT_RE.lastIndex = 0;
  while ((match = TEMPLATE_IMPORT_RE.exec(src)) !== null) {
    if (match[1] !== undefined) specs.push(match[1]);
  }

  return specs;
}

// Strip line comments (//...) and block comments (/* ... */) from JS source
// to avoid false positives when checking identifier boundaries or import
// specifiers that appear only inside comment text (e.g. JSDoc @example blocks).
function stripComments(src: string): string {
  // Replace block comments with spaces to preserve line/column positions.
  let result = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' ')
  );
  // Replace line comments.
  result = result.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  return result;
}

// Check whether `id` appears as a standalone identifier in `src` (after
// comment stripping). Uses a word-boundary approach so `tokenColors` does not
// match inside e.g. `notTokenColors`.
function containsIdentifier(src: string, id: string): boolean {
  const re = new RegExp(`\\b${id}\\b`);
  return re.test(src);
}

// Walk the transitive import graph of `entryFile`, collecting all local
// relative imports (those starting with "./" or "../"). External packages are
// NOT followed — they are checked by the forbidden-module rule instead.
// Returns an object with:
//   - `sources`: Map from absolute file path to source text (readable files)
//   - `unreadable`: Set of absolute paths that could not be read
// Callers get source content without a second round of disk reads.
function collectCoreFiles(entryFile: string): {
  sources: Map<string, string>;
  unreadable: Set<string>;
} {
  const sources = new Map<string, string>();
  const unreadable = new Set<string>();
  const queue: string[] = [entryFile];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (sources.has(file) || unreadable.has(file)) continue;

    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      unreadable.add(file);
      continue;
    }

    sources.set(file, src);

    const dir = dirname(file);
    for (const specifier of extractImportSpecifiers(src)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        // Resolve the relative path. The built JS uses explicit .js extensions.
        const candidate = resolve(dir, specifier);
        if (!sources.has(candidate) && !unreadable.has(candidate)) {
          queue.push(candidate);
        }
      }
    }
  }
  return { sources, unreadable };
}

// Scan the transitive import graph of a single dist entry file for forbidden
// external imports (shiki/@shikijs/@pierre/theme/react/react-dom/preact) and
// forbidden identifiers (document/window/tokenColors). Returns an array of
// human-readable violation strings (empty = clean). The graph walk follows only
// relative imports, so the core entry is checked against exactly the files it
// actually bundles.
function findEntryViolations(entryFile: string): string[] {
  const { sources, unreadable } = collectCoreFiles(entryFile);
  const violations: string[] = [];

  for (const file of unreadable) {
    violations.push(`${file}: could not read file`);
  }

  for (const [file, rawSrc] of sources) {
    // Never scan source maps.
    if (file.endsWith('.map')) continue;

    // Strip comments once and reuse the result for both checks so that import
    // specifiers inside JSDoc @example blocks or inline comments do not produce
    // false positives.
    const src = stripComments(rawSrc);

    // Check for forbidden external imports. We match against the comment-
    // stripped source so that specifiers appearing only in comment text are
    // ignored. extractImportSpecifiers covers both quoted static imports and
    // template-literal dynamic imports (returning the static prefix).
    for (const specifier of extractImportSpecifiers(src)) {
      // Only check non-relative (external) specifiers.
      if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
      for (const forbidden of FORBIDDEN_MODULES) {
        if (specifier === forbidden || specifier.startsWith(forbidden + '/')) {
          violations.push(`${file}: imports forbidden module "${specifier}"`);
        }
      }
    }

    // Check for forbidden identifiers after stripping comments to avoid
    // false positives from prose in comment blocks.
    for (const id of FORBIDDEN_IDENTIFIERS) {
      if (containsIdentifier(src, id)) {
        violations.push(`${file}: contains forbidden identifier "${id}"`);
      }
    }
  }

  return violations;
}

// Scan the core entry (`<distDir>/index.js`) and its transitive relative
// imports. Exported for use by the dist-guard tests.
export function findCoreViolations(distDir: string): string[] {
  return findEntryViolations(resolve(distDir, 'index.js'));
}

// Run a single named guard, printing a clear PASS/FAIL line that identifies
// which entry was checked. Returns true when the entry is clean.
function reportEntry(label: string, violations: string[]): boolean {
  if (violations.length > 0) {
    console.error(
      `\n[assert-core-clean] FAIL (${label}) — ${violations.length} violation(s) found:\n`
    );
    for (const v of violations) {
      console.error(`  ✗ ${v}`);
    }
    console.error('');
    return false;
  }
  console.log(`[assert-core-clean] PASS (${label}) — dist is clean.`);
  return true;
}

if (import.meta.main) {
  const distDir = resolve(import.meta.dir, '../dist');

  // The root entry owns the dependency-free controller/resolver primitives.
  // Source-specific integrations live behind /themes.
  const coreOk = reportEntry('core', findCoreViolations(distDir));

  process.exit(coreOk ? 0 : 1);
}
