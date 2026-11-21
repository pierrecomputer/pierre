import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { FileDiff } from '../src/components/FileDiff';
import { UnresolvedFile } from '../src/components/UnresolvedFile';
import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import {
  disposeHighlighter,
  preloadHighlighter,
} from '../src/highlighter/shared_highlighter';
import { i18n } from '../src/i18n/I18n';
import type {
  CodeViewItem,
  FileContents,
  FileDiffMetadata,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  createRoot,
  dispatchScroll,
  installDom,
  renderItems,
  wait,
  waitFor,
} from './domHarness';

const FRENCH = {
  locale: 'fr',
  messages: {
    unmodifiedLines:
      '{count, plural, one {# ligne inchangée} other {# lignes inchangées}}',
    expandAll: 'Tout déplier',
    noNewlineAtEndOfFile: 'Pas de saut de ligne à la fin du fichier',
    acceptCurrentChange: 'Accepter la modification actuelle',
    acceptIncomingChange: 'Accepter la modification entrante',
    acceptBoth: 'Accepter les deux',
  },
};

const CONFLICT_FILE: FileContents = {
  name: 'conflict.ts',
  contents: [
    'const start = true;',
    '<<<<<<< HEAD',
    'const ttl = 12;',
    '=======',
    'const ttl = 24;',
    '>>>>>>> feature',
    'const end = true;',
    '',
  ].join('\n'),
};

// Twenty lines without a trailing newline, changed near the end so the diff
// shows a collapsed-context separator and a no-newline marker.
function parseFixture(name = 'translated.txt'): FileDiffMetadata {
  const oldLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const newLines = oldLines.map((line, i) => (i === 18 ? 'changed' : line));
  return parseDiffFromFile(
    { name, contents: oldLines.join('\n') },
    { name, contents: newLines.join('\n') }
  );
}

function shadowText(element: HTMLElement | undefined): string {
  return element?.shadowRoot?.textContent ?? '';
}

describe('i18n subscriptions', () => {
  beforeAll(async () => {
    await preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: ['text'],
    });
  });

  afterAll(async () => {
    await disposeHighlighter();
  });

  afterEach(() => {
    i18n.set();
  });

  test('a mounted FileDiff re-renders its text when messages change', async () => {
    const dom = installDom();
    const instance = new FileDiff<undefined>({
      diffStyle: 'unified',
      disableFileHeader: true,
      expansionLineCount: 5,
      theme: DEFAULT_THEMES,
    });
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    try {
      instance.render({ fileDiff: parseFixture(), fileContainer });
      await waitFor(() =>
        shadowText(fileContainer).includes('unmodified lines')
      );
      expect(shadowText(fileContainer)).toContain('unmodified lines');
      expect(shadowText(fileContainer)).toContain('No newline at end of file');

      i18n.set(FRENCH);
      await waitFor(() =>
        shadowText(fileContainer).includes('lignes inchangées')
      );
      const text = shadowText(fileContainer);
      expect(text).toContain('lignes inchangées');
      expect(text).toContain('Tout déplier');
      expect(text).toContain('Pas de saut de ligne à la fin du fichier');
      expect(text).not.toContain('unmodified lines');
      expect(text).not.toContain('No newline at end of file');
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a mounted FileDiff header regroups its counts when the locale changes', async () => {
    const dom = installDom();
    const instance = new FileDiff<undefined>({
      collapsed: true,
      theme: DEFAULT_THEMES,
    });
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    try {
      const name = 'large.txt';
      const fileDiff = parseDiffFromFile(
        { name, contents: '' },
        {
          name,
          contents: Array.from({ length: 1234 }, (_, i) => `line ${i}\n`).join(
            ''
          ),
        }
      );
      instance.render({ fileDiff, fileContainer });
      await waitFor(() => shadowText(fileContainer).includes('+1,234'));
      expect(shadowText(fileContainer)).toContain('+1,234');

      i18n.set({ locale: 'de' });
      await waitFor(() => shadowText(fileContainer).includes('+1.234'));
      expect(shadowText(fileContainer)).toContain('+1.234');
      expect(shadowText(fileContainer)).not.toContain('+1,234');
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a FileDiff listens once it has rendered, not before', () => {
    const dom = installDom();
    const instance = new FileDiff<undefined>({ theme: DEFAULT_THEMES });
    const heard = spyOn(instance, 'onMessagesChange');
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    try {
      i18n.set({ locale: 'de' });
      expect(heard).not.toHaveBeenCalled();

      instance.render({ fileDiff: parseFixture(), fileContainer });
      i18n.set({ locale: 'fr' });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a mounted UnresolvedFile re-renders its conflict actions', async () => {
    const dom = installDom();
    const instance = new UnresolvedFile<undefined>({
      disableFileHeader: true,
      mergeConflictActionsType: 'default',
      theme: DEFAULT_THEMES,
    });
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    try {
      instance.render({ file: CONFLICT_FILE, fileContainer });
      await waitFor(() => shadowText(fileContainer).includes('Accept both'));
      expect(shadowText(fileContainer)).toContain('Accept current change');
      expect(shadowText(fileContainer)).toContain('Accept incoming change');
      expect(shadowText(fileContainer)).toContain('Accept both');

      i18n.set(FRENCH);
      await waitFor(() =>
        shadowText(fileContainer).includes('Accepter les deux')
      );
      const text = shadowText(fileContainer);
      expect(text).toContain('Accepter la modification actuelle');
      expect(text).toContain('Accepter la modification entrante');
      expect(text).toContain('Accepter les deux');
      expect(text).not.toContain('Accept both');
    } finally {
      instance.cleanUp();
      dom.cleanup();
    }
  });

  test('a cleaned up FileDiff no longer listens', () => {
    const dom = installDom();
    const instance = new FileDiff<undefined>({
      diffStyle: 'unified',
      disableFileHeader: true,
      theme: DEFAULT_THEMES,
    });
    const fileContainer = document.createElement('div');
    document.body.appendChild(fileContainer);
    try {
      instance.render({ fileDiff: parseFixture(), fileContainer });
      const rerender = spyOn(instance, 'rerender');
      instance.cleanUp();
      i18n.set(FRENCH);
      expect(rerender).not.toHaveBeenCalled();
    } finally {
      dom.cleanup();
    }
  });

  test('a CodeView header scrolled away regroups its counts once it is back', async () => {
    const dom = installDom();
    const viewer = new CodeView<undefined, undefined>({
      theme: DEFAULT_THEMES,
    });
    const root = createRoot();
    const items: CodeViewItem<undefined>[] = [
      {
        id: 'large',
        type: 'diff',
        collapsed: true,
        version: 1,
        fileDiff: parseDiffFromFile(
          { name: 'large.txt', contents: '' },
          {
            name: 'large.txt',
            contents: Array.from(
              { length: 1234 },
              (_, i) => `line ${i}\n`
            ).join(''),
          }
        ),
      },
      ...Array.from({ length: 400 }, (_, i) => ({
        id: `small:${i}`,
        type: 'diff' as const,
        collapsed: true,
        version: 1,
        fileDiff: parseFixture(`small-${i}.txt`),
      })),
    ];
    const renderedIds = () =>
      viewer.getRenderedItems().map((rendered) => rendered.item.id);
    const largeHeaderText = () =>
      shadowText(
        viewer
          .getRenderedItems()
          .find((rendered) => rendered.item.id === 'large')?.element
      );
    try {
      viewer.setup(root);
      await renderItems(viewer, items);
      await waitFor(() => largeHeaderText().includes('+1,234'));
      expect(largeHeaderText()).toContain('+1,234');

      root.scrollTop = viewer.getTopForItem('small:399') ?? 0;
      dispatchScroll(root);
      viewer.render(true);
      await wait(0);
      expect(renderedIds().length).toBeGreaterThan(0);
      expect(renderedIds()).not.toContain('large');

      i18n.set({ locale: 'de' });

      root.scrollTop = 0;
      dispatchScroll(root);
      viewer.render(true);
      await waitFor(() => largeHeaderText().includes('+1.234'));
      expect(largeHeaderText()).toContain('+1.234');
    } finally {
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('only mounted CodeView items hear a message change', async () => {
    const dom = installDom();
    const viewer = new CodeView<undefined, undefined>({
      theme: DEFAULT_THEMES,
    });
    const root = createRoot();
    const makeItems = (prefix: string): CodeViewItem<undefined>[] =>
      Array.from({ length: 300 }, (_, i) => ({
        id: `${prefix}:${i}`,
        type: 'diff',
        version: 1,
        fileDiff: parseFixture(`${prefix}-${i}.txt`),
      }));
    const heard = spyOn(VirtualizedFileDiff.prototype, 'onMessagesChange');
    try {
      viewer.setup(root);
      await renderItems(viewer, makeItems('first'));
      // A whole new list goes through the full reconcile, not the append path.
      await renderItems(viewer, makeItems('second'));
      const mounted = viewer.getRenderedItems().length;
      expect(mounted).toBeGreaterThan(0);
      expect(mounted).toBeLessThan(300);
      heard.mockClear();

      i18n.set({ locale: 'de' });

      expect(heard).toHaveBeenCalledTimes(mounted);
    } finally {
      heard.mockRestore();
      viewer.cleanUp();
      dom.cleanup();
    }
  });

  test('mounted CodeView items re-render when messages change', async () => {
    const dom = installDom();
    const viewer = new CodeView<undefined, undefined>({
      diffStyle: 'unified',
      disableFileHeader: true,
      expansionLineCount: 5,
      theme: DEFAULT_THEMES,
    });
    const root = createRoot();
    const items: CodeViewItem<undefined>[] = [
      { id: 'diff:a', type: 'diff', fileDiff: parseFixture('a.txt') },
      { id: 'diff:b', type: 'diff', fileDiff: parseFixture('b.txt') },
    ];
    let cleanedUp = false;
    try {
      viewer.setup(root);
      await renderItems(viewer, items);
      const elements = viewer.getRenderedItems().map((item) => item.element);
      expect(elements.length).toBe(2);
      await waitFor(() =>
        elements.every((element) =>
          shadowText(element).includes('unmodified lines')
        )
      );
      for (const element of elements) {
        expect(shadowText(element)).toContain('unmodified lines');
      }

      i18n.set(FRENCH);
      await waitFor(() =>
        elements.every((element) =>
          shadowText(element).includes('lignes inchangées')
        )
      );
      for (const element of elements) {
        expect(shadowText(element)).toContain('lignes inchangées');
        expect(shadowText(element)).not.toContain('unmodified lines');
      }

      const rerenders = viewer
        .getRenderedItems()
        .map((item) => spyOn(item.instance, 'rerender'));
      viewer.cleanUp();
      cleanedUp = true;
      i18n.set();
      for (const rerender of rerenders) {
        expect(rerender).not.toHaveBeenCalled();
      }
    } finally {
      // An assertion failing above must not leave items subscribed, or the
      // next test's `i18n.set()` would render into a torn-down DOM.
      if (!cleanedUp) {
        viewer.cleanUp();
      }
      dom.cleanup();
    }
  });
});
