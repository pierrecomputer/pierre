import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  extractImportSpecifiers,
  findCoreViolations,
} from '../../scripts/assert-core-clean';

const PKG_DIR = resolve(import.meta.dir, '../..');
const DIST_DIR = join(PKG_DIR, 'dist');

// Include the process PID in every tmp dir name so parallel test runs cannot
// race on the same path when creating or deleting temp fixtures.
const pid = process.pid;

function distUrl(entry: string): string {
  return pathToFileURL(join(DIST_DIR, entry)).href;
}

// Dist freshness is the task graph's job: theming:test depends on
// theming:build (see packages/theming/moon.yml), so moon builds (or
// cache-validates) dist before this suite runs. The test itself must never
// build or restore dist — a nested `moon run theming:build` here triggers a
// cache hydration that clears and rewrites dist while sibling tasks
// (diffs/trees tests and typechecks) are resolving @pierre/theming through
// it, which broke CI. Guard against a missing dist instead.
beforeAll(() => {
  if (!existsSync(join(DIST_DIR, 'index.js'))) {
    throw new Error(
      'packages/theming/dist is missing. Run `moonx theming:build` (or any ' +
        'task depending on it) first; theming:test declares that dependency.'
    );
  }
});

describe('core dist guard', () => {
  test('finds no violations in the current clean dist', () => {
    const violations = findCoreViolations(DIST_DIR);
    expect(violations).toEqual([]);
  });

  // Positive-control: verify the guard actually flags a file that imports shiki.
  // We write a temp dir with a fake index.js that imports shiki and assert that
  // findCoreViolations reports the violation. This proves the guard detects
  // problems rather than always returning an empty array.
  test('flags a file that imports a forbidden module', () => {
    const tmpDir = join(tmpdir(), `guard-test-shiki-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      // Write a fake index.js that side-effect-imports shiki (no from keyword).
      writeFileSync(
        join(tmpDir, 'index.js'),
        `import "shiki";\nexport const x = 1;\n`
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('"shiki"'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Positive-control: verify the guard flags a file containing tokenColors.
  test('flags a file that contains tokenColors', () => {
    const tmpDir = join(tmpdir(), `guard-test-tokencolors-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'index.js'),
        `export const theme = { tokenColors: [] };\n`
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('"tokenColors"'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Positive-control: verify the guard flags a file referencing window.
  test('flags a file that references the window global', () => {
    const tmpDir = join(tmpdir(), `guard-test-window-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'index.js'),
        `export const w = window.location;\n`
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('"window"'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Verify the guard does NOT false-positive when a forbidden word appears only
  // inside a comment in a dist file.
  test('does not flag forbidden words that appear only in comments', () => {
    const tmpDir = join(tmpdir(), `guard-test-comments-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'index.js'),
        // The word "shiki" and "window" appear only in comments, not as
        // identifiers or import specifiers.
        `// This module does not use shiki or window.\n/* tokenColors are irrelevant here */\nexport const x = 1;\n`
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // Positive-control: verify that @shikijs/core (a scoped sub-path) IS flagged.
  // Before the fix, FORBIDDEN_MODULES stored '@shikijs/' with a trailing slash,
  // making `startsWith('@shikijs//')` never match — so @shikijs/core would
  // silently pass. This test would have passed (no violation) before the fix.
  test('flags a file that imports @shikijs/core', () => {
    const tmpDir = join(tmpdir(), `guard-test-shikijs-core-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'index.js'),
        `import { x } from "@shikijs/core";\nexport const y = x;\n`
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('"@shikijs/core"'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // No-false-positive control: a forbidden module name that appears ONLY inside
  // a JSDoc comment (e.g. an @example block) must NOT be flagged. Before the
  // fix the import scan ran on raw source, so JSDoc examples would trigger.
  test('does not flag a forbidden import that appears only in a JSDoc comment', () => {
    const tmpDir = join(tmpdir(), `guard-test-jsdoc-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'index.js'),
        // "react" appears only inside a block comment — the real code is clean.
        `/** @example import x from "react" */\nexport const y = 1;\n`
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations).toEqual([]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// Recursively collect every built `.js` file (excluding `.map`) under `dir`,
// returning their absolute paths.
function collectJsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

describe('dist import isolation', () => {
  // Prove the heavyweight imports are confined to their dedicated source paths:
  // Shiki-packaged theme imports live in dist/collections/shiki.js via the
  // narrow @shikijs/themes package,
  // @pierre/theme imports live in dist/collections/pierre.js, and shiki/core
  // normalization is allowed only in the createTheme adapter used by theme
  // collections that adapt raw VS Code themes. This is what lets the other
  // entries (core and react) stay source-data-free.
  //
  // Uses extractImportSpecifiers (shared with the guard script) so that
  // template-literal dynamic imports — e.g. import(`@pierre/theme/${name}`) —
  // are visible. Without this, the test
  // would pass vacuously because the old quoted-only regex could not see those
  // imports at all.
  test('source-specific imports stay out of core/react', () => {
    const jsFiles = collectJsFiles(DIST_DIR);
    const shikiCoreOffenders: string[] = [];
    const shikiThemeOffenders: string[] = [];
    const pierreOffenders: string[] = [];
    // Non-vacuity tracking: confirm that the known loaders are actually detected.
    let shikiCoreDetected = false;
    let shikiThemeDetected = false;
    let pierreEntryDetected = false;

    for (const file of jsFiles) {
      const rel = relative(DIST_DIR, file);
      const specs = extractImportSpecifiers(readFileSync(file, 'utf8'));

      const importsShikiCore = specs.some(
        (s) =>
          s === 'shiki/core' ||
          s === '@shikijs/core' ||
          s === '@shikijs/primitive'
      );
      const importsShikiTheme = specs.some(
        (s) =>
          s === 'shiki' ||
          (s.startsWith('shiki/') && s !== 'shiki/core') ||
          s === '@shikijs' ||
          s === '@shikijs/themes' ||
          s.startsWith('@shikijs/themes/')
      );
      const importsPierreTheme = specs.some(
        (s) => s === '@pierre/theme' || s.startsWith('@pierre/theme/')
      );

      if (importsShikiCore) {
        if (rel === 'modules/createTheme.js') {
          shikiCoreDetected = true;
        } else {
          shikiCoreOffenders.push(rel);
        }
      }
      if (importsShikiTheme) {
        if (rel === 'collections/shiki.js') {
          shikiThemeDetected = true;
        } else {
          shikiThemeOffenders.push(rel);
        }
      }
      if (importsPierreTheme) {
        if (rel === 'collections/pierre.js') {
          pierreEntryDetected = true;
        } else {
          pierreOffenders.push(rel);
        }
      }
    }

    // Non-vacuity: the scan must have actually found the expected importer files
    // so that passing means detection worked, not that detection was skipped.
    expect(shikiCoreDetected).toBe(true);
    expect(shikiThemeDetected).toBe(true);
    expect(pierreEntryDetected).toBe(true);

    expect(shikiCoreOffenders).toEqual([]);
    expect(shikiThemeOffenders).toEqual([]);
    expect(pierreOffenders).toEqual([]);
  });

  test('first-party Pierre theme imports are statically analyzable', () => {
    const pierreEntry = join(DIST_DIR, 'collections/pierre.js');
    const specs = extractImportSpecifiers(readFileSync(pierreEntry, 'utf8'));

    expect(specs).toContain('@pierre/theme/pierre-light');
    expect(specs).toContain('@pierre/theme/pierre-light-soft');
    expect(specs).toContain('@pierre/theme/pierre-dark');
    expect(specs).toContain('@pierre/theme/pierre-dark-soft');
    expect(specs).not.toContain('@pierre/theme/');
  });

  test('Shiki theme loaders use the narrow themes package', () => {
    const shikiEntry = join(DIST_DIR, 'collections/shiki.js');
    const specs = extractImportSpecifiers(readFileSync(shikiEntry, 'utf8'));

    expect(specs.some((s) => s.startsWith('@shikijs/themes/'))).toBe(true);
    expect(specs).not.toContain('shiki/themes/');
  });
});

describe('dist export smoke', () => {
  test('built public entries expose the expected APIs', async () => {
    const [core, color, react, themes] = await Promise.all([
      import(distUrl('index.js')),
      import(distUrl('color.js')),
      import(distUrl('react.js')),
      import(distUrl('themes.js')),
    ]);

    expect(typeof core.createThemeCatalog).toBe('function');
    expect(typeof core.createThemeCollection).toBe('function');
    expect(typeof core.createThemeController).toBe('function');
    expect(typeof core.createThemeResolver).toBe('function');
    expect(typeof core.DuplicateThemeError).toBe('function');

    // The color entry owns normalizeThemeColors + the colorUtils transform bag.
    expect(typeof color.normalizeThemeColors).toBe('function');
    expect(typeof color.colorUtils).toBe('object');
    expect(typeof color.colorUtils.pickReadableForeground).toBe('function');
    expect(typeof color.colorUtils.deriveMutedFg).toBe('function');
    expect(core.defaultThemeResolver).toBeUndefined();
    expect(core.defineTheme).toBeUndefined();
    expect(core.getAllThemes).toBeUndefined();
    expect(core.getLightThemes).toBeUndefined();
    expect(core.getDarkThemes).toBeUndefined();
    expect(core.getDefaultLightTheme).toBeUndefined();
    expect(core.getDefaultDarkTheme).toBeUndefined();
    expect(core.pierreThemes).toBeUndefined();
    expect(core.bundledShikiThemes).toBeUndefined();
    expect(core.bundledShikiTheme).toBeUndefined();
    expect(core.shikiTheme).toBeUndefined();
    expect(core.defineShikiTheme).toBeUndefined();
    expect(core.createTheme).toBeUndefined();
    expect(core.themes).toBeUndefined();
    expect(core.shikiThemes).toBeUndefined();
    expect(typeof react.useThemeController).toBe('function');
    expect(typeof themes.createTheme).toBe('function');
    expect(typeof themes.themes).toBe('object');
    expect(typeof themes.pierreThemes).toBe('object');
    expect(typeof themes.shikiThemes).toBe('object');
    expect(themes.defineShikiTheme).toBeUndefined();
    expect(themes.registerPierreThemes).toBeUndefined();
    expect(themes.bundledShikiThemes).toBeUndefined();
    expect(themes.bundledShikiTheme).toBeUndefined();
    expect(themes.shikiTheme).toBeUndefined();
    expect(themes.registerShikiTheme).toBeUndefined();
    expect(themes.registerBundledShikiTheme).toBeUndefined();

    const themeTypes = readFileSync(join(DIST_DIR, 'themes.d.ts'), 'utf8');
    expect(themeTypes).not.toContain('BundledThemeCollection');
    expect(themeTypes).not.toContain('PierreThemeName');
    expect(themeTypes).not.toContain('ShikiThemeName');
  });
});

describe('template-literal import detection', () => {
  // Positive-control: a core entry whose ONLY forbidden import is expressed as a
  // template-literal dynamic import must still be flagged by the guard. Before
  // the fix, the quoted-only regex would silently miss this import, making the
  // guard pass vacuously.
  test('flags a template-literal dynamic import of a forbidden module', () => {
    const tmpDir = join(tmpdir(), `guard-test-template-literal-${pid}`);
    try {
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(
        join(tmpDir, 'index.js'),
        // Template-literal import — deliberately not a quoted import.
        'export async function load(name) { return import(`shiki/themes/${name}.mjs`); }\n'
      );
      const violations = findCoreViolations(tmpDir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.includes('shiki/'))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// Clean up any stale tmp dirs left by a previously-aborted run for this pid.
afterAll(() => {
  for (const suffix of [
    'shiki',
    'tokencolors',
    'window',
    'comments',
    'shikijs-core',
    'jsdoc',
    'template-literal',
  ]) {
    try {
      rmSync(join(tmpdir(), `guard-test-${suffix}-${pid}`), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
  }
});
