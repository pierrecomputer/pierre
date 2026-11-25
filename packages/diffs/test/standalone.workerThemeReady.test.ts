import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { LanguageRegistration, ThemeRegistration } from 'shiki';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import { registerCustomLanguage } from '../src/highlighter/languages/registerCustomLanguage';
import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { customThemes } from '../src/highlighter/themes/themeResolver';
import {
  DiffHunksRenderer,
  type HunksRenderResult,
} from '../src/renderers/DiffHunksRenderer';
import {
  FileRenderer,
  type FileRenderResult,
} from '../src/renderers/FileRenderer';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';
import { installDom, wait, waitFor } from './domHarness';
import {
  contentAST,
  createDeferred,
  fileContentAST,
  getRejection,
  projectColumn,
} from './testUtils';
import { createInitializingManager, withTimeout } from './workerPoolHarness';

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

const original = { name: 'answer.ts', contents: 'const answer = 0;\n' };
const updated = { ...original, contents: 'const answer = 42;\n' };
const updatedDiff = parseDiffFromFile(original, updated);

test('cold standalone rows paint during a pending grammar preload and gain worker tokens automatically', async () => {
  const dom = installDom();
  const language = 'standalone-held-grammar';
  const grammar = createDeferred<{ default: LanguageRegistration[] }>();
  const registration = {
    default: [
      {
        name: language,
        scopeName: 'source.held',
        patterns: [],
        repository: {},
      },
    ],
  };
  registerCustomLanguage(language, () => grammar.promise);
  const { manager, worker, initialization } = createInitializingManager({
    theme: 'pierre-dark',
    langs: [language],
    lineDiffType: 'none',
  });
  const fileContainer = document.createElement('div');
  const diffContainer = document.createElement('div');
  const file = new File({}, manager);
  const diff = new FileDiff({ diffStyle: 'unified' }, manager);
  const removedFile = new File({}, manager);
  const removedRetry = spyOn(removedFile, 'rerender');
  const fileRetry = spyOn(file, 'rerender');
  const diffRetry = spyOn(diff, 'rerender');
  const fileRow = () =>
    fileContainer.shadowRoot?.querySelector('[data-line="1"]');
  const diffRow = () =>
    diffContainer.shadowRoot?.querySelector(
      '[data-line][data-line-type="change-addition"]'
    );
  try {
    removedFile.render({
      file: updated,
      fileContainer: document.createElement('div'),
    });
    removedFile.cleanUp();
    file.render({ file: original, fileContainer });
    diff.render({
      fileDiff: parseDiffFromFile(updated, original),
      fileContainer: diffContainer,
    });
    file.render({ file: updated, fileContainer });
    diff.render({ fileDiff: updatedDiff, fileContainer: diffContainer });
    expect(fileRow()).toBeNull();
    expect(diffRow()).toBeNull();

    await waitFor(() => fileRow() != null && diffRow() != null);
    for (const row of [fileRow(), diffRow()]) {
      expect(row?.textContent).toBe(updated.contents.trimEnd());
      expect(row?.children.length).toBe(1);
    }
    expect(removedRetry).not.toHaveBeenCalled();
    expect(fileRetry).toHaveBeenCalledTimes(1);
    expect(diffRetry).toHaveBeenCalledTimes(1);
    expect(manager.getStats().readyWorkers).toBe(0);

    grammar.resolve(registration);
    const setup = await withTimeout(worker.waitForInitializeRequest());
    worker.respond({
      type: 'success',
      requestType: 'initialize',
      id: setup.id,
      sentAt: Date.now(),
    });
    await initialization;
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['typescript'],
    });
    const fileRequest = await withTimeout(worker.waitForFileRequest());
    const fileOptions = manager.getFileRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'file',
      id: fileRequest.id,
      options: fileOptions,
      result: renderFileWithHighlighter(
        fileRequest.file,
        highlighter,
        fileOptions
      ),
      sentAt: Date.now(),
    });
    const diffRequest = await withTimeout(worker.waitForDiffRequest());
    const diffOptions = manager.getDiffRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'diff',
      id: diffRequest.id,
      options: diffOptions,
      result: renderDiffWithHighlighter(
        diffRequest.diff,
        highlighter,
        diffOptions
      ),
      sentAt: Date.now(),
    });
    for (const row of [fileRow(), diffRow()]) {
      expect(row?.textContent).toBe(updated.contents.trimEnd());
      expect(row?.children.length).toBeGreaterThan(1);
    }
  } finally {
    grammar.resolve(registration);
    void initialization.catch(() => {});
    file.cleanUp();
    diff.cleanUp();
    manager.terminate();
    RegisteredCustomLanguages.delete(language);
    dom.cleanup();
  }
});

test.each([-1, 200])(
  'blocked plain rows paint when initialization retries the theme (mainThreadMaxCharacters %i)',
  async (mainThreadMaxCharacters) => {
    const dom = installDom();
    const theme = `standalone-retried-theme-${mainThreadMaxCharacters}`;
    const firstLoad = createDeferred<ThemeRegistration>();
    const language = `standalone-retry-grammar-${mainThreadMaxCharacters}`;
    const preload = createDeferred<void>();
    registerCustomLanguage(language, async () => {
      await preload.promise;
      return {
        default: [
          {
            name: language,
            scopeName: 'source.retry',
            patterns: [],
            repository: {},
          },
        ],
      };
    });
    let loads = 0;
    registerCustomTheme(theme, async () =>
      ++loads === 1
        ? firstLoad.promise
        : { name: theme, type: 'dark', colors: {}, tokenColors: [] }
    );
    const report = spyOn(console, 'error').mockImplementation(() => {});
    const { manager, initialization, worker } = createInitializingManager(
      { theme, preferredHighlighter: 'shiki-js' },
      { mainThreadMaxCharacters }
    );
    const file = new File({}, manager);
    const diff = new FileDiff({ diffStyle: 'unified' }, manager);
    const fileContainer = document.createElement('div');
    const diffContainer = document.createElement('div');
    const before = { name: 'answer.txt', contents: 'before\n' };
    const after = { ...before, contents: 'after\n' };
    const rows = () => [
      fileContainer.shadowRoot?.querySelector('[data-line="1"]')?.textContent,
      diffContainer.shadowRoot?.querySelector(
        '[data-line-type="change-addition"][data-line]'
      )?.textContent,
    ];
    try {
      file.render({ file: after, fileContainer });
      diff.render({
        fileDiff: parseDiffFromFile(before, after),
        fileContainer: diffContainer,
      });
      await waitFor(() => loads === 1 && getHighlighterIfLoaded() != null);
      const error = new Error('theme unavailable');
      firstLoad.reject(error);
      expect(await getRejection(initialization)).toBe(error);
      await wait(0);
      expect(loads).toBe(1);
      expect(rows()).toEqual([undefined, undefined]);

      const retry = manager.initialize([language]);
      await waitFor(() => rows().every((text) => text === 'after'));
      expect(rows()).toEqual(['after', 'after']);
      expect(loads).toBe(2);
      preload.resolve();
      const setup = await withTimeout(worker.waitForInitializeRequest());
      worker.respond({
        type: 'success',
        requestType: 'initialize',
        id: setup.id,
        sentAt: Date.now(),
      });
      await retry;
    } finally {
      preload.resolve();
      file.cleanUp();
      diff.cleanUp();
      manager.terminate();
      report.mockRestore();
      customThemes.delete(theme);
      RegisteredCustomLanguages.delete(language);
      dom.cleanup();
    }
  }
);

test('a theme change paints through the owner while an obsolete theme is pending', async () => {
  const dom = installDom();
  const themeName = 'standalone-obsolete-theme';
  const obsolete = createDeferred<ThemeRegistration>();
  registerCustomTheme(themeName, () => obsolete.promise);
  const { manager, initialization } = createInitializingManager({
    theme: themeName,
  });
  const report = spyOn(console, 'error').mockImplementation(() => {});
  const diffContainer = document.createElement('div');
  let renders = 0;
  const diff = new FileDiff({ diffStyle: 'unified' }, manager, () => {
    renders++;
    diff.render({ fileDiff: updatedDiff, fileContainer: diffContainer });
  });
  const readChanged = () =>
    diffContainer.shadowRoot?.querySelector(
      '[data-line][data-line-type="change-addition"]'
    );
  try {
    diff.render({ fileDiff: updatedDiff, fileContainer: diffContainer });
    expect(readChanged()).toBeNull();
    await manager.setRenderOptions({ theme: 'github-light' });
    expect(readChanged()?.textContent).toBe(updated.contents.trimEnd());
    expect(renders).toBe(1);
    const changedRow = readChanged();

    const stale = getRejection(
      getSharedHighlighter({ themes: [themeName], langs: [] })
    );
    const error = new Error('obsolete theme failed');
    obsolete.reject(error);
    expect(await stale).toBe(error);
    await wait(0);
    expect(readChanged()).toBe(changedRow);
    expect(renders).toBe(1);
  } finally {
    obsolete.resolve({
      name: themeName,
      type: 'dark',
      colors: {},
      tokenColors: [],
    });
    void initialization.catch(() => {});
    diff.cleanUp();
    manager.terminate();
    report.mockRestore();
    customThemes.delete(themeName);
    dom.cleanup();
  }
});

test('direct renderers render once for a theme change while the obsolete theme is held', async () => {
  await getSharedHighlighter({
    themes: [],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
  const dom = installDom();
  const themeName = 'standalone-renderer-obsolete-theme';
  const obsolete = createDeferred<ThemeRegistration>();
  const obsoleteRegistration: ThemeRegistration = {
    name: themeName,
    type: 'dark',
    colors: {},
    tokenColors: [],
  };
  const themeLoader = mock(() => obsolete.promise);
  registerCustomTheme(themeName, themeLoader);
  const { manager, initialization } = createInitializingManager(
    { theme: themeName, preferredHighlighter: 'shiki-js' },
    { mainThreadMaxCharacters: 200 }
  );
  const report = spyOn(console, 'error').mockImplementation(() => {});
  let fileResult: FileRenderResult | undefined;
  let diffResult: HunksRenderResult | undefined;
  const onFileUpdate = mock(() => {
    fileResult = fileRenderer.renderFile(updated);
  });
  const onDiffUpdate = mock(() => {
    diffResult = diffRenderer.renderDiff(updatedDiff);
  });
  const fileRenderer: FileRenderer = new FileRenderer(
    {},
    undefined,
    onFileUpdate,
    manager
  );
  const diffRenderer: DiffHunksRenderer = new DiffHunksRenderer(
    { diffStyle: 'unified' },
    undefined,
    onDiffUpdate,
    manager
  );
  const lineTexts = (cells: Parameters<typeof projectColumn>[0]) =>
    projectColumn(cells).map((row) => row.text);
  try {
    expect(fileRenderer.renderFile(updated)).toBeUndefined();
    expect(diffRenderer.renderDiff(updatedDiff)).toBeUndefined();
    await waitFor(() => themeLoader.mock.calls.length > 0);
    expect(themeLoader).toHaveBeenCalled();

    // The obsolete theme stays held; committing github-light alone must paint.
    await manager.setRenderOptions({ theme: 'github-light' });
    await waitFor(
      () =>
        onFileUpdate.mock.calls.length > 0 && onDiffUpdate.mock.calls.length > 0
    );
    expect(onFileUpdate).toHaveBeenCalledTimes(1);
    expect(onDiffUpdate).toHaveBeenCalledTimes(1);
    expect(lineTexts(fileContentAST(fileResult))).toContain(
      updated.contents.trimEnd()
    );
    expect(lineTexts(contentAST(diffResult, 'unified'))).toContain(
      updated.contents.trimEnd()
    );

    // Settling the obsolete theme must not render again.
    obsolete.resolve(obsoleteRegistration);
    await getSharedHighlighter({ themes: [themeName], langs: [] });
    await wait(0);
    expect(onFileUpdate).toHaveBeenCalledTimes(1);
    expect(onDiffUpdate).toHaveBeenCalledTimes(1);
  } finally {
    obsolete.resolve(obsoleteRegistration);
    void initialization.catch(() => {});
    fileRenderer.cleanUp();
    diffRenderer.cleanUp();
    manager.terminate();
    report.mockRestore();
    customThemes.delete(themeName);
    dom.cleanup();
  }
});

test.each([-1, 200])(
  'mounted views finish a cold first paint after pool termination (mainThreadMaxCharacters %i)',
  async (mainThreadMaxCharacters) => {
    const dom = installDom();
    const { manager, initialization } = createInitializingManager(
      { theme: 'pierre-dark' },
      { mainThreadMaxCharacters }
    );
    const file = new File({}, manager);
    const diff = new FileDiff({ diffStyle: 'unified' }, manager);
    const fileContainer = document.createElement('div');
    const diffContainer = document.createElement('div');
    const rows = () => [
      fileContainer.shadowRoot?.querySelector('[data-line="1"]'),
      diffContainer.shadowRoot?.querySelector(
        '[data-line][data-line-type="change-addition"]'
      ),
    ];
    try {
      file.render({ file: updated, fileContainer });
      diff.render({ fileDiff: updatedDiff, fileContainer: diffContainer });
      expect(rows()).toEqual([null, null]);
      manager.terminate();
      await initialization;

      await waitFor(() =>
        rows().every((row) => (row?.children.length ?? 0) > 1)
      );
      for (const row of rows()) {
        expect(row?.textContent).toBe(updated.contents.trimEnd());
        expect(row?.children.length).toBeGreaterThan(1);
      }
    } finally {
      file.cleanUp();
      diff.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  }
);

test.each(['shiki-js', 'highlights'] as const)(
  'small files and diffs with a ready grammar paint %s syntax on their first render after the theme loads',
  async (preferredHighlighter) => {
    if (preferredHighlighter === 'shiki-js') {
      await getSharedHighlighter({
        themes: [],
        langs: ['typescript'],
        preferredHighlighter,
      });
    }
    const dom = installDom();
    const { manager, initialization, worker } = createInitializingManager(
      { theme: 'pierre-dark', preferredHighlighter },
      { mainThreadMaxCharacters: 200 }
    );
    const file = new File({}, manager);
    const diff = new FileDiff({ diffStyle: 'unified' }, manager);
    const fileRetry = spyOn(file, 'rerender');
    const diffRetry = spyOn(diff, 'rerender');
    const fileContainer = document.createElement('div');
    const diffContainer = document.createElement('div');
    const tokenCount = (container: HTMLElement) =>
      container.shadowRoot?.querySelector('[data-line="1"]')?.children.length ??
      0;
    try {
      file.render({ file: updated, fileContainer });
      diff.render({ fileDiff: updatedDiff, fileContainer: diffContainer });
      await waitFor(
        () => tokenCount(fileContainer) > 1 && tokenCount(diffContainer) > 1
      );
      expect(tokenCount(fileContainer)).toBeGreaterThan(1);
      expect(tokenCount(diffContainer)).toBeGreaterThan(1);
      await wait(0);
      expect(fileRetry).toHaveBeenCalledTimes(1);
      expect(diffRetry).toHaveBeenCalledTimes(1);
      expect(manager.getStats().queuedTasks).toBe(0);
      expect(worker.fileRequestCount + worker.diffRequestCount).toBe(0);
    } finally {
      void initialization.catch(() => {});
      file.cleanUp();
      diff.cleanUp();
      manager.terminate();
      dom.cleanup();
    }
  }
);

test.each([
  ['resolve', 'shiki-js', 'pending'],
  ['reject', 'shiki-js', 'pending'],
  ['resolve', 'highlights', 'pending'],
  ['reject', 'highlights', 'failed'],
] as const)(
  'small Shiki file and diff load a cold theme with the grammar and paint plain rows before grammars %s with %s workers (%s pool)',
  async (outcome, workerBackend, pool) => {
    if (workerBackend === 'highlights') {
      await getSharedHighlighter({
        themes: [],
        langs: [],
        preferredHighlighter: 'shiki-js',
      });
    }
    const dom = installDom();
    const id = `standalone-small-${outcome}-${workerBackend}-${pool}`;
    const theme = `${id}-theme`;
    const language = `${id}-grammar`;
    const themeLoad = createDeferred<ThemeRegistration>();
    const grammar = createDeferred<{ default: LanguageRegistration[] }>();
    const themeRegistration: ThemeRegistration = {
      name: theme,
      type: 'dark',
      colors: {},
      tokenColors: [
        { scope: 'keyword.control', settings: { foreground: '#ff0000' } },
      ],
    };
    const registration = {
      default: [
        {
          name: language,
          scopeName: 'source.small',
          patterns: [{ match: 'const', name: 'keyword.control' }],
          repository: {},
        },
      ],
    };
    const themeLoader = mock(() => themeLoad.promise);
    const grammarLoader = mock(() => grammar.promise);
    registerCustomTheme(theme, themeLoader);
    registerCustomLanguage(language, grammarLoader);
    if (workerBackend === 'highlights') {
      // Highlights workers use an independent Zed registration of the theme.
      registerCustomTheme(
        theme,
        () => Promise.resolve({ name: theme, appearance: 'dark', style: {} }),
        'zed'
      );
    }
    const report = spyOn(console, 'error').mockImplementation(() => {});
    const { manager, initialization, worker } = createInitializingManager(
      { theme, preferredHighlighter: workerBackend, lineDiffType: 'none' },
      { mainThreadMaxCharacters: 200 }
    );
    const file = new File({}, manager);
    const diff = new FileDiff({ diffStyle: 'unified' }, manager);
    const fileContainer = document.createElement('div');
    const diffContainer = document.createElement('div');
    const rows = () => [
      fileContainer.shadowRoot?.querySelector('[data-line="1"]'),
      diffContainer.shadowRoot?.querySelector(
        '[data-line-type="change-addition"][data-line]'
      ),
    ];
    try {
      if (pool === 'failed') {
        // The pool has already failed before the first render.
        const failure = getRejection(initialization);
        await withTimeout(worker.waitForInitializeRequest());
        worker.emitError(new Error('worker unavailable'));
        await failure;
        expect(manager.shouldUseLocalFallback()).toBe(true);
        report.mockClear();
      }
      file.render({ file: { ...updated, lang: language }, fileContainer });
      diff.render({
        fileDiff: { ...updatedDiff, lang: language },
        fileContainer: diffContainer,
      });
      // Theme and grammar load concurrently: both start before either settles.
      await waitFor(
        () =>
          themeLoader.mock.calls.length > 0 &&
          grammarLoader.mock.calls.length > 0
      );
      expect(themeLoader).toHaveBeenCalled();
      expect(grammarLoader).toHaveBeenCalled();
      expect(rows()).toEqual([null, null]);

      themeLoad.resolve(themeRegistration);
      await waitFor(() => rows().every((row) => row != null));
      for (const row of rows()) {
        expect(row?.textContent).toBe(updated.contents.trimEnd());
        expect(row?.children.length).toBe(1);
      }
      if (outcome === 'reject') {
        const plainRows = rows();
        const error = new Error('Small Shiki grammar failed');
        grammar.reject(error);
        await waitFor(() => report.mock.calls.length === 2);
        expect(report.mock.calls).toEqual([[error], [error]]);
        rows().forEach((row, index) => expect(row).toBe(plainRows[index]));
      } else {
        grammar.resolve(registration);
        await waitFor(() =>
          rows().every((row) => (row?.children.length ?? 0) > 1)
        );
        for (const row of rows()) {
          expect(row?.children[0]?.textContent).toBe('const');
        }
      }
      expect(worker.fileRequestCount + worker.diffRequestCount).toBe(0);
    } finally {
      themeLoad.resolve(themeRegistration);
      grammar.resolve(registration);
      void initialization.catch(() => {});
      file.cleanUp();
      diff.cleanUp();
      manager.terminate();
      customThemes.delete(theme);
      RegisteredCustomLanguages.delete(language);
      report.mockRestore();
      dom.cleanup();
    }
  }
);
