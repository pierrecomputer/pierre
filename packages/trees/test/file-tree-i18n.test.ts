import { afterEach, describe, expect, test } from 'bun:test';
import type { JSDOM } from 'jsdom';

import { DEFAULT_TRANSLATIONS } from '../src/constants';
import { compileMessage } from '../src/i18n/compileMessage';
import { i18n } from '../src/i18n/I18n';
import type { FileTreeI18nConfig } from '../src/publicTypes';
import { renameFileTreePaths } from '../src/utils/renameFileTreePaths';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadPreloadFileTree } from './helpers/loadFileTree';

const en = new Intl.PluralRules('en');

describe('compileMessage', () => {
  test('returns plain text unchanged', () => {
    expect(compileMessage('Expand all', en)()).toBe('Expand all');
  });

  test('substitutes {name} arguments', () => {
    const message = compileMessage('{index} of {count}', en);
    expect(message({ index: 2, count: 7 })).toBe('2 of 7');
  });

  test('picks the plural branch for the locale and fills #', () => {
    const message = compileMessage(
      '{count, plural, one {# line} other {# lines}}',
      en
    );
    expect(message({ count: 0 })).toBe('0 lines');
    expect(message({ count: 1 })).toBe('1 line');
    expect(message({ count: 12 })).toBe('12 lines');
  });

  test('supports locales with more than two plural forms', () => {
    const message = compileMessage(
      '{count, plural, one {# строка} few {# строки} many {# строк} other {# строки}}',
      new Intl.PluralRules('ru')
    );
    expect(message({ count: 1 })).toBe('1 строка');
    expect(message({ count: 3 })).toBe('3 строки');
    expect(message({ count: 5 })).toBe('5 строк');
    expect(message({ count: 21 })).toBe('21 строка');
  });

  test('falls back to other when the locale picks an absent category', () => {
    const message = compileMessage('{count, plural, other {# 行}}', en);
    expect(message({ count: 1 })).toBe('1 行');
  });

  test('keeps text around the plural block and other arguments', () => {
    const message = compileMessage(
      'Found {count, plural, one {# match} other {# matches}} in {file}',
      en
    );
    expect(message({ count: 2, file: 'a.ts' })).toBe('Found 2 matches in a.ts');
  });

  test('rejects a plural block without other', () => {
    expect(() => compileMessage('{count, plural, one {# line}}', en)).toThrow(
      '"other"'
    );
  });

  test('rejects an unknown plural category', () => {
    expect(() =>
      compileMessage('{count, plural, single {# line} other {# lines}}', en)
    ).toThrow('unknown plural category "single"');
  });

  test('accepts ICU whitespace around the plural argument', () => {
    const message = compileMessage(
      '{count , plural , one {# line} other {# lines}}',
      en
    );
    expect(message({ count: 1 })).toBe('1 line');
  });

  test('rejects a malformed plural block', () => {
    expect(() => compileMessage('{count, plural, one # line}', en)).toThrow(
      'unsupported syntax'
    );
  });

  test('rejects more than one plural block', () => {
    expect(() =>
      compileMessage('{a, plural, other {#}} and {b, plural, other {#}}', en)
    ).toThrow('unsupported syntax');
  });

  test('rejects ICU syntax outside the subset at compile time', () => {
    expect(() =>
      compileMessage('{mode, select, compact {Short} other {Long}}', en)
    ).toThrow('unsupported syntax');
    expect(() => compileMessage('{count, number}', en)).toThrow(
      'unsupported syntax'
    );
    expect(() => compileMessage('stray } brace', en)).toThrow(
      'unsupported syntax'
    );
  });

  test('rejects a duplicate plural category', () => {
    expect(() =>
      compileMessage('{count, plural, one {a} one {b} other {c}}', en)
    ).toThrow('duplicate plural category "one"');
  });

  test('throws when an argument is missing at format time', () => {
    const message = compileMessage('{count} results', en);
    expect(() => message()).toThrow('"count" was not provided');
  });

  test('throws when the plural argument is not a number', () => {
    const message = compileMessage('{count, plural, other {#}}', en);
    expect(() => message({ count: 'many' })).toThrow('must be a number');
  });
});

const FILES = ['README.md', 'src/index.ts', 'src/utils/worker.ts'] as const;

const FRENCH: FileTreeI18nConfig = {
  locale: 'fr',
  translations: {
    searchPlaceholder: 'Rechercher…',
    gitStatusModified: 'Statut git : modifié',
    gitStatusUntracked: 'Statut git : non suivi',
    containsGitStatus: 'Contient des modifications git',
    renameEmptyName: 'Le nom ne peut pas être vide.',
    renamePathExists: '« {path} » existe déjà.',
  },
};

function getGitTitle(
  shadowRoot: ShadowRoot | null | undefined,
  path: string
): string | null {
  return (
    shadowRoot
      ?.querySelector(
        `[data-item-path="${path}"] [data-item-section="git"] > span`
      )
      ?.getAttribute('title') ?? null
  );
}

function getSearchPlaceholder(
  shadowRoot: ShadowRoot | null | undefined
): string | null {
  return (
    shadowRoot
      ?.querySelector('[data-file-tree-search-input]')
      ?.getAttribute('placeholder') ?? null
  );
}

async function renderTree(dom: JSDOM) {
  const FileTree = await loadFileTree();
  const mount = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(mount);
  const fileTree = new FileTree({
    flattenEmptyDirectories: false,
    gitStatus: [
      { path: 'README.md', status: 'untracked' },
      { path: 'src/index.ts', status: 'modified' },
    ],
    initialExpansion: 'open',
    paths: FILES,
    search: true,
    initialVisibleRowCount: 180 / 30,
  });
  fileTree.render({ containerWrapper: mount });
  await flushDom();
  return fileTree;
}

describe('i18n', () => {
  afterEach(() => {
    i18n.set();
  });

  test('renders the English defaults', () => {
    expect(i18n.t('searchPlaceholder')).toBe('Search…');
    expect(i18n.t('renameItem', { name: 'README.md' })).toBe(
      'Rename README.md'
    );
    expect(i18n.t('renamePathExists', { path: 'src/a.ts' })).toBe(
      '"src/a.ts" already exists.'
    );
    expect(i18n.t('gitStatusModified')).toBe('Git status: modified');
  });

  test('set replaces translations, and left-out ones fall back to English', () => {
    i18n.set({
      translations: { ...FRENCH.translations, gitStatusAdded: undefined },
    });
    expect(i18n.t('searchPlaceholder')).toBe('Rechercher…');
    expect(i18n.t('renamePathExists', { path: 'a.ts' })).toBe(
      '« a.ts » existe déjà.'
    );
    expect(i18n.t('gitStatusAdded')).toBe('Git status: added');
    expect(i18n.t('contextMenuTrigger')).toBe('Options');
  });

  test('set with no config restores English', () => {
    i18n.set(FRENCH);
    i18n.set();
    for (const [key, value] of Object.entries(DEFAULT_TRANSLATIONS)) {
      if (key === 'renameItem' || key === 'renamePathExists') {
        continue;
      }
      expect(i18n.t(key as keyof typeof DEFAULT_TRANSLATIONS)).toBe(value);
    }
  });

  test('notifies subscribers once per effective change', () => {
    const initialVersion = i18n.version;
    let notified = 0;
    const unsubscribe = i18n.subscribe({
      onTranslationsChange: () => {
        notified++;
      },
    });
    i18n.set(FRENCH);
    expect(notified).toBe(1);
    // Same config again: nothing changed, nobody is told.
    i18n.set(FRENCH);
    expect(notified).toBe(1);
    expect(i18n.version).toBe(initialVersion + 1);
    unsubscribe();
    i18n.set();
    expect(notified).toBe(1);
  });

  test('a bad translation throws and leaves the previous config in place', () => {
    i18n.set(FRENCH);
    expect(() =>
      i18n.set({ translations: { searchPlaceholder: 'Search {' } })
    ).toThrow('unsupported syntax');
    expect(i18n.t('searchPlaceholder')).toBe('Rechercher…');
  });

  test('an unknown translation key throws', () => {
    const translations: Record<string, string> = { searchPlacehodler: 'x' };
    expect(() => i18n.set({ translations })).toThrow(
      'unknown translation "searchPlacehodler"'
    );
  });
});

describe('file-tree i18n', () => {
  afterEach(() => {
    i18n.set();
  });

  test('a mounted tree renders English, then re-renders on set', async () => {
    const { cleanup, dom } = installDom();
    try {
      const fileTree = await renderTree(dom);
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(getSearchPlaceholder(shadowRoot)).toBe('Search…');
      expect(getGitTitle(shadowRoot, 'src/index.ts')).toBe(
        'Git status: modified'
      );
      expect(getGitTitle(shadowRoot, 'src/')).toBe('Contains git status items');

      i18n.set(FRENCH);
      await flushDom();

      expect(getSearchPlaceholder(shadowRoot)).toBe('Rechercher…');
      expect(getGitTitle(shadowRoot, 'src/index.ts')).toBe(
        'Statut git : modifié'
      );
      expect(getGitTitle(shadowRoot, 'README.md')).toBe(
        'Statut git : non suivi'
      );
      expect(getGitTitle(shadowRoot, 'src/')).toBe(
        'Contient des modifications git'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('a cleaned up tree no longer listens', async () => {
    const { cleanup, dom } = installDom();
    try {
      const fileTree = await renderTree(dom);
      let rerenders = 0;
      const original = fileTree.onTranslationsChange.bind(fileTree);
      fileTree.onTranslationsChange = () => {
        rerenders++;
        original();
      };

      i18n.set(FRENCH);
      expect(rerenders).toBe(1);

      fileTree.cleanUp();
      i18n.set();
      expect(rerenders).toBe(1);
    } finally {
      cleanup();
    }
  });

  test('preloadFileTree renders the current translations into SSR markup', async () => {
    const preloadFileTree = await loadPreloadFileTree();
    i18n.set(FRENCH);
    const payload = preloadFileTree({
      flattenEmptyDirectories: false,
      gitStatus: [{ path: 'src/index.ts', status: 'modified' }],
      initialExpansion: 'open',
      paths: FILES,
      search: true,
      initialVisibleRowCount: 180 / 30,
    });

    expect(payload.shadowHtml).toContain('placeholder="Rechercher…"');
    expect(payload.shadowHtml).toContain('title="Statut git : modifié"');
    expect(payload.shadowHtml).not.toContain('Git status: modified');
  });

  test('rename errors come from the store', () => {
    i18n.set(FRENCH);
    const files = ['a.ts', 'b.ts'];

    expect(
      renameFileTreePaths({
        files,
        path: 'a.ts',
        isFolder: false,
        nextBasename: '  ',
      })
    ).toEqual({ error: 'Le nom ne peut pas être vide.' });
    expect(
      renameFileTreePaths({
        files,
        path: 'a.ts',
        isFolder: false,
        nextBasename: 'b.ts',
      })
    ).toEqual({ error: '« b.ts » existe déjà.' });
    // Left out of the French config, so it stays English.
    expect(
      renameFileTreePaths({
        files,
        path: 'a.ts',
        isFolder: false,
        nextBasename: 'x/y',
      })
    ).toEqual({ error: 'Name cannot include "/".' });
  });
});
