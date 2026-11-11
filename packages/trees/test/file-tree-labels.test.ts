import { describe, expect, test } from 'bun:test';
import type { JSDOM } from 'jsdom';

import type { FileTreeLabelsOption } from '../src/model/publicTypes';
import { DEFAULT_FILE_TREE_LABELS } from '../src/utils/fileTreeLabels';
import { flushDom, installDom } from './helpers/dom';
import { loadFileTree, loadPreloadFileTree } from './helpers/loadFileTree';

const FILES = ['README.md', 'src/index.ts', 'src/utils/worker.ts'] as const;

const FRENCH_LABELS: FileTreeLabelsOption = {
  searchPlaceholder: 'Rechercher…',
  gitStatusTitles: {
    modified: 'Statut git : modifie',
    untracked: 'Statut git : non suivi',
  },
  containsGitStatusTitle: 'Contient des modifications git',
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

async function renderTree(dom: JSDOM, labels?: FileTreeLabelsOption) {
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
    labels,
    paths: FILES,
    search: true,
    initialVisibleRowCount: 180 / 30,
  });
  fileTree.render({ containerWrapper: mount });
  await flushDom();
  return fileTree;
}

describe('file-tree labels', () => {
  test('renders English defaults when no labels are given', async () => {
    const { cleanup, dom } = installDom();
    try {
      const fileTree = await renderTree(dom);
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(getSearchPlaceholder(shadowRoot)).toBe(
        DEFAULT_FILE_TREE_LABELS.searchPlaceholder
      );
      expect(getGitTitle(shadowRoot, 'src/index.ts')).toBe(
        'Git status: modified'
      );
      expect(getGitTitle(shadowRoot, 'src/')).toBe('Contains git status items');

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('renders custom labels and falls back per git status', async () => {
    const { cleanup, dom } = installDom();
    try {
      const fileTree = await renderTree(dom, {
        ...FRENCH_LABELS,
        gitStatusTitles: { modified: 'Statut git : modifie' },
      });
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      expect(getSearchPlaceholder(shadowRoot)).toBe('Rechercher…');
      expect(getGitTitle(shadowRoot, 'src/index.ts')).toBe(
        'Statut git : modifie'
      );
      expect(getGitTitle(shadowRoot, 'README.md')).toBe(
        'Git status: untracked'
      );
      expect(getGitTitle(shadowRoot, 'src/')).toBe(
        'Contient des modifications git'
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('setLabels re-renders the mounted tree and resets omitted labels', async () => {
    const { cleanup, dom } = installDom();
    try {
      const fileTree = await renderTree(dom);
      const shadowRoot = fileTree.getFileTreeContainer()?.shadowRoot;

      fileTree.setLabels(FRENCH_LABELS);
      await flushDom();

      expect(getSearchPlaceholder(shadowRoot)).toBe('Rechercher…');
      expect(getGitTitle(shadowRoot, 'README.md')).toBe(
        'Statut git : non suivi'
      );

      fileTree.setLabels({ searchPlaceholder: 'Suchen…' });
      await flushDom();

      expect(getSearchPlaceholder(shadowRoot)).toBe('Suchen…');
      expect(getGitTitle(shadowRoot, 'README.md')).toBe(
        'Git status: untracked'
      );

      fileTree.setLabels(undefined);
      await flushDom();

      expect(getSearchPlaceholder(shadowRoot)).toBe(
        DEFAULT_FILE_TREE_LABELS.searchPlaceholder
      );

      fileTree.cleanUp();
    } finally {
      cleanup();
    }
  });

  test('preloadFileTree renders custom labels into the SSR markup', async () => {
    const preloadFileTree = await loadPreloadFileTree();
    const payload = preloadFileTree({
      flattenEmptyDirectories: false,
      gitStatus: [{ path: 'src/index.ts', status: 'modified' }],
      initialExpansion: 'open',
      labels: FRENCH_LABELS,
      paths: FILES,
      search: true,
      initialVisibleRowCount: 180 / 30,
    });

    expect(payload.shadowHtml).toContain('placeholder="Rechercher…"');
    expect(payload.shadowHtml).toContain('title="Statut git : modifie"');
    expect(payload.shadowHtml).not.toContain('Git status: modified');
  });
});
