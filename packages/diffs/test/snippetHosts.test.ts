import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createTwoFilesPatch } from 'diff';
import { act, createElement, type ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  FileDiff,
  parseDiffFromFile,
  parsePatchFiles,
  SnippetFile,
  SnippetFileDiff,
} from '../src';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { SnippetFile as ReactSnippetFile } from '../src/react/SnippetFile';
import { SnippetFileDiff as ReactSnippetFileDiff } from '../src/react/SnippetFileDiff';
import { Virtualizer } from '../src/react/Virtualizer';
import { preloadSnippetFile, preloadSnippetFileDiff } from '../src/ssr';
import type { DiffsHighlighter } from '../src/types';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import { installDom, wait, waitFor } from './domHarness';
import {
  boundaryLabel,
  click,
  FIFTY_LINES,
  foldLabels,
  interiorLabels,
  makeDiff,
  makeMixedDiff,
  numberedLines,
  queryAll,
  renderedLines,
  sideLines,
  STYLES,
} from './snippetHarness';
import { createInitializedManager, withTimeout } from './workerPoolHarness';

let highlighter: DiffsHighlighter;
beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(async () => {
  await disposeHighlighter();
});

const RANGE = { start: 41, end: 78 };

// Rows drawn with highlighted tokens (inline token styles).
function styledRows(container: HTMLElement): number {
  return queryAll(container, '[data-content] [data-line] span[style]').length;
}

describe('snippet SSR', () => {
  test('hydrating a preloaded SnippetFileDiff keeps the markup; folds are live', async () => {
    for (const diffStyle of STYLES) {
      const fileDiff = makeMixedDiff();
      const options = {
        disableFileHeader: true,
        diffStyle,
        theme: 'pierre-dark',
        lineRange: RANGE,
        expansionLineCount: 5,
      } as const;
      const { prerenderedHTML } = await preloadSnippetFileDiff({
        fileDiff,
        options,
      });
      expect(prerenderedHTML).toContain('data-snippet-boundary="above"');
      const { cleanup } = installDom();
      const instance = new SnippetFileDiff(options);
      try {
        const container = document.createElement('div');
        document.body.append(container);
        instance.hydrate({
          fileContainer: container,
          fileDiff,
          prerenderedHTML,
        });
        const pre = container.shadowRoot!.querySelector('pre');
        const before = pre?.innerHTML;
        await wait(50);
        expect(container.shadowRoot!.querySelector('pre')).toBe(pre);
        expect(pre?.innerHTML).toBe(before);
        // Interior click: the expansion was readied at hydrate.
        click(interiorLabels(container)[0]);
        await waitFor(() => sideLines(container).add.includes(45));
        expect(sideLines(container).add.some((l) => l < 40 || l > 78)).toBe(
          false
        );
        click(boundaryLabel(container, 'below'));
        await waitFor(() => sideLines(container).add.includes(80));
        expect(sideLines(container).add).toContain(83);
      } finally {
        instance.cleanUp();
        cleanup();
      }
    }
  });

  test('hydrating a preloaded SnippetFile keeps the markup', async () => {
    const options = {
      disableFileHeader: true,
      lineRange: { start: 20, end: 25 },
    };
    const { prerenderedHTML } = await preloadSnippetFile({
      file: FIFTY_LINES,
      options,
    });
    const { cleanup } = installDom();
    const instance = new SnippetFile(options);
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.hydrate({
        fileContainer: container,
        file: FIFTY_LINES,
        prerenderedHTML,
      });
      const pre = container.shadowRoot?.querySelector('pre');
      await wait(50);
      expect(container.shadowRoot?.querySelector('pre')).toBe(pre);
      expect(foldLabels(container)).toEqual([
        '19 unmodified lines',
        '25 unmodified lines',
      ]);
      click(boundaryLabel(container, 'above'));
      await waitFor(() => renderedLines(container)[0] === 1);
      expect(renderedLines(container)[0]).toBe(1);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  // The server markup records its range; hydrating with a different
  // lineRange re-renders the client's range at once instead of keeping
  // stale rows.
  test('a client lineRange that differs from the server re-renders on hydrate', async () => {
    const fileDiff = makeMixedDiff();
    const { prerenderedHTML } = await preloadSnippetFileDiff({
      fileDiff,
      options: { diffStyle: 'unified', lineRange: RANGE },
    });
    const { cleanup } = installDom();
    const instance = new SnippetFileDiff({
      diffStyle: 'unified',
      lineRange: { start: 10, end: 20 },
    });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      expect(prerenderedHTML).toContain('data-snippet-range="41-78"');
      instance.hydrate({ fileContainer: container, fileDiff, prerenderedHTML });
      await waitFor(() => sideLines(container).add[0] === 10);
      expect(sideLines(container).add[0]).toBe(10);
      expect(sideLines(container).add.includes(41)).toBe(false);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('a SnippetFile hydrated with a different lineRange re-renders', async () => {
    const { prerenderedHTML } = await preloadSnippetFile({
      file: FIFTY_LINES,
      options: { lineRange: { start: 20, end: 25 } },
    });
    const { cleanup } = installDom();
    const instance = new SnippetFile({ lineRange: { start: 30, end: 32 } });
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.hydrate({
        fileContainer: container,
        file: FIFTY_LINES,
        prerenderedHTML,
      });
      await waitFor(() => renderedLines(container)[0] === 30);
      expect(renderedLines(container)).toEqual([30, 31, 32]);
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('preloadSnippetFileDiff of identical files renders the range', async () => {
    const file = {
      name: 'f.ts',
      contents: numberedLines(40).join('\n') + '\n',
    };
    const { prerenderedHTML } = await preloadSnippetFileDiff({
      fileDiff: parseDiffFromFile(file, { ...file }),
      options: { lineRange: { start: 11, end: 20 } },
    });
    expect(prerenderedHTML).toContain('10 unmodified lines');
    expect(prerenderedHTML).toContain('data-line="11"');
  });

  test('preloadSnippetFileDiff renders the change pills of a fold hiding changes', async () => {
    const { prerenderedHTML } = await preloadSnippetFileDiff({
      fileDiff: makeDiff([5, 30]),
      options: { lineRange: { start: 25, end: 35 } },
    });
    expect(prerenderedHTML).toContain('25 lines, includes changes');
    expect(prerenderedHTML).toMatch(
      /<span data-snippet-change-counts="" role="img" aria-label="1 removed, 1 added"><span data-snippet-deletions-count="">-1<\/span><span data-snippet-additions-count="">\+1<\/span><\/span>/
    );
  });

  test('preloadSnippetFileDiff rejects a partial diff before rendering', async () => {
    const old = numberedLines(20).join('\n') + '\n';
    const patch = createTwoFilesPatch(
      'f.txt',
      'f.txt',
      old,
      old.replace('line 9\n', 'nine\n')
    );
    const partial = parsePatchFiles(patch)[0].files[0];
    const error = await preloadSnippetFileDiff({
      fileDiff: partial,
      options: { lineRange: { start: 1, end: 3 } },
    }).catch((caught: unknown) => caught);
    expect(String(error)).toContain('a partial diff');
  });
});

describe('snippets with a worker pool', () => {
  test('widening and interior clicks before and after the highlight arrives', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error');
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      for (const diffStyle of STYLES) {
        const diff = makeMixedDiff(3, `pool-${diffStyle}`);
        const container = document.createElement('div');
        document.body.append(container);
        const instance = new SnippetFileDiff(
          {
            disableFileHeader: true,
            diffStyle,
            theme: 'pierre-dark',
            lineRange: RANGE,
            expansionLineCount: 5,
            disableErrorHandling: true,
          },
          manager
        );
        instance.render({ fileContainer: container, fileDiff: diff });
        await waitFor(
          () => container.shadowRoot?.querySelector('code') != null
        );
        const request = await withTimeout(worker.waitForDiffRequest());
        // Before the worker answers: the windowed plain-AST path.
        expect(instance.expandSnippet('above', 5)).toBe(true);
        expect(instance.expandSnippet('below', 5)).toBe(true);
        click(interiorLabels(container)[0]);
        await waitFor(() => sideLines(container).add.includes(45));
        const plain = sideLines(container);
        expect(plain.add).toContain(36);
        expect(
          queryAll(container, '[data-content] [data-line]').filter(
            (row) => (row.textContent ?? '').length === 0
          )
        ).toHaveLength(0);
        const options = manager.getDiffRenderOptions();
        worker.respond({
          type: 'success',
          requestType: 'diff',
          id: request.id,
          result: renderDiffWithHighlighter(diff, highlighter, options),
          options,
          sentAt: Date.now(),
        });
        await waitFor(() => styledRows(container) > 0);
        expect(sideLines(container)).toEqual(plain);
        expect(instance.expandSnippet('above', 10)).toBe(true);
        await waitFor(() => sideLines(container).add.includes(26));
        expect(
          queryAll(container, '[data-content] [data-line="26"]')[0]?.textContent
        ).toContain('line 26');
        instance.cleanUp();
      }
      expect(
        consoleError.mock.calls.filter((call) =>
          String(call[0]).includes('are null')
        )
      ).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
      manager.terminate();
      cleanup();
    }
  });

  // Review finding: the context-hunk diff of identical files must not share
  // the original's cacheKey, or a highlight cached for the hunkless diff by
  // a plain FileDiff is reused for rows it does not have.
  test('identical files with cacheKeys: a FileDiff then a snippet on one pool', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    try {
      const contents = numberedLines(40).join('\n') + '\n';
      const diff = parseDiffFromFile(
        { name: 'f.ts', contents, cacheKey: 'same:old' },
        { name: 'f.ts', contents, cacheKey: 'same:new' }
      );
      expect(diff.hunks).toHaveLength(0);
      const plainContainer = document.createElement('div');
      document.body.append(plainContainer);
      const plain = new FileDiff(
        { theme: 'pierre-dark', disableFileHeader: true },
        manager
      );
      plain.render({ fileContainer: plainContainer, fileDiff: diff });
      const request = await withTimeout(worker.waitForDiffRequest());
      const options = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(request.diff, highlighter, options),
        options,
        sentAt: Date.now(),
      });
      await wait(50);
      plain.cleanUp();
      const container = document.createElement('div');
      document.body.append(container);
      const snippet = new SnippetFileDiff(
        {
          theme: 'pierre-dark',
          disableFileHeader: true,
          lineRange: { start: 11, end: 20 },
        },
        manager
      );
      snippet.render({ fileContainer: container, fileDiff: diff });
      await waitFor(() => renderedLines(container).length > 0);
      expect(renderedLines(container)).toEqual(
        numberedLines(10).map((_, i) => i + 11)
      );
      expect(
        consoleError.mock.calls.filter((call) =>
          String(call[0]).includes('are null')
        )
      ).toHaveLength(0);
      snippet.cleanUp();
    } finally {
      consoleError.mockRestore();
      manager.terminate();
      cleanup();
    }
  });

  // Accepted behavior, pinned: with a worker pool, a click after SSR
  // hydration but before the client's highlight arrives redraws the clip as
  // plain text; the highlight replaces it when the worker answers.
  test('a click after hydration but before highlighting draws plain text until it arrives', async () => {
    const diff = makeMixedDiff(3, 'pool-hydrate');
    const options = {
      disableFileHeader: true,
      diffStyle: 'unified',
      theme: 'pierre-dark',
      lineRange: RANGE,
      expansionLineCount: 5,
    } as const;
    const { prerenderedHTML } = await preloadSnippetFileDiff({
      fileDiff: diff,
      options,
    });
    const { cleanup } = installDom();
    const { manager, worker } = await createInitializedManager({
      theme: 'pierre-dark',
    });
    const instance = new SnippetFileDiff(options, manager);
    try {
      const container = document.createElement('div');
      document.body.append(container);
      instance.hydrate({
        fileContainer: container,
        fileDiff: diff,
        prerenderedHTML,
      });
      // Server markup is highlighted.
      expect(styledRows(container)).toBeGreaterThan(0);
      click(boundaryLabel(container, 'above'));
      await waitFor(() => sideLines(container).add.includes(36));
      expect(sideLines(container).add).toContain(36);
      expect(styledRows(container)).toBe(0);
      const request = await withTimeout(worker.waitForDiffRequest());
      const renderOptions = manager.getDiffRenderOptions();
      worker.respond({
        type: 'success',
        requestType: 'diff',
        id: request.id,
        result: renderDiffWithHighlighter(diff, highlighter, renderOptions),
        options: renderOptions,
        sentAt: Date.now(),
      });
      await waitFor(() => styledRows(container) > 0);
      expect(styledRows(container)).toBeGreaterThan(0);
      expect(sideLines(container).add).toContain(36);
    } finally {
      instance.cleanUp();
      manager.terminate();
      cleanup();
    }
  });
});

describe('React snippets', () => {
  function mount() {
    const handle = installDom();
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    return {
      container,
      async render(next: ReactNode) {
        await act(async () => {
          root.render(next);
          await wait(0);
        });
      },
      async cleanUp() {
        await act(async () => {
          root.unmount();
          await wait(0);
        });
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        handle.cleanup();
      },
    };
  }

  test('SnippetFileDiff renders, hands its instance to onPostRender, and keeps reveals for an equal range', async () => {
    let instance: SnippetFileDiff | undefined;
    const fileDiff = makeMixedDiff();
    const element = (lineRange: { start: number; end: number }) =>
      createElement(ReactSnippetFileDiff<undefined>, {
        fileDiff,
        options: {
          diffStyle: 'unified',
          disableFileHeader: true,
          lineRange,
          onPostRender: (_node, next) => {
            instance = next;
          },
        },
      });
    const mounted = mount();
    try {
      await mounted.render(element(RANGE));
      const host = mounted.container.querySelector(
        'diffs-container'
      ) as HTMLElement;
      await waitFor(() => host.shadowRoot?.querySelector('code') != null);
      expect(instance).toBeInstanceOf(SnippetFileDiff);
      // A reader click goes through the React-owned render path.
      await act(async () => {
        click(interiorLabels(host)[0]);
        await wait(0);
      });
      expect(sideLines(host).add).toContain(45);
      await act(async () => {
        instance!.expandSnippet('below', 2);
        await wait(0);
      });
      // An equal (new object) range keeps the reveal and the expansion.
      await mounted.render(element({ ...RANGE }));
      expect(sideLines(host).add.at(-1)).toBe(80);
      expect(sideLines(host).add).toContain(45);
      // A different range is a fresh layout.
      await mounted.render(element({ start: 30, end: 31 }));
      expect(renderedLines(host, 'additions')).toEqual([30, 31]);
    } finally {
      await mounted.cleanUp();
    }
  });

  // StrictMode attaches each ref, detaches it and attaches it again on the
  // same host node (see reactStrictMode.test.ts): the second instance must
  // end with the same rows, folds and a working boundary click.
  test('StrictMode remounts render the same snippet as a plain mount', async () => {
    const elements = [
      () =>
        createElement(ReactSnippetFileDiff<undefined>, {
          fileDiff: makeMixedDiff(),
          options: {
            diffStyle: 'split',
            disableFileHeader: true,
            lineRange: RANGE,
          },
        }),
      () =>
        createElement(ReactSnippetFile<undefined>, {
          file: FIFTY_LINES,
          options: {
            disableFileHeader: true,
            lineRange: { start: 20, end: 25 },
          },
        }),
    ];
    for (const element of elements) {
      const results: unknown[] = [];
      for (const strict of [false, true]) {
        const mounted = mount();
        try {
          await mounted.render(
            strict ? createElement(StrictMode, null, element()) : element()
          );
          const host = mounted.container.querySelector(
            'diffs-container'
          ) as HTMLElement;
          await waitFor(() => renderedLines(host).length > 0);
          const before = {
            lines: renderedLines(host),
            labels: foldLabels(host),
            boundaries: queryAll(host, '[data-snippet-boundary]').length,
          };
          await act(async () => {
            click(boundaryLabel(host, 'above'));
            await wait(0);
          });
          results.push({ before, after: renderedLines(host)[0] });
        } finally {
          await mounted.cleanUp();
        }
      }
      expect(results[1]).toEqual(results[0]);
      expect((results[0] as { after: number }).after).toBe(1);
    }
  });

  test('SnippetFileDiff renders a renamed file', async () => {
    const next = numberedLines(30);
    next[19] = 'line 20 CHANGED';
    const fileDiff = parseDiffFromFile(
      { name: 'old.ts', contents: numberedLines(30).join('\n') + '\n' },
      { name: 'new.ts', contents: next.join('\n') + '\n' }
    );
    const mounted = mount();
    try {
      await mounted.render(
        createElement(ReactSnippetFileDiff<undefined>, {
          fileDiff,
          options: { diffStyle: 'split', lineRange: { start: 19, end: 21 } },
        })
      );
      const host = mounted.container.querySelector(
        'diffs-container'
      ) as HTMLElement;
      await waitFor(() => host.shadowRoot?.querySelector('code') != null);
      expect(sideLines(host)).toEqual({ add: [19, 20, 21], del: [20] });
      expect(host.shadowRoot?.textContent).toContain('new.ts');
    } finally {
      await mounted.cleanUp();
    }
  });

  test('throws inside a Virtualizer instead of swapping classes', async () => {
    const mounted = mount();
    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = () => {};
    try {
      const root = createRoot(document.createElement('div'));
      try {
        await act(async () => {
          root.render(
            createElement(
              Virtualizer,
              null,
              createElement(ReactSnippetFileDiff<undefined>, {
                fileDiff: makeMixedDiff(),
                options: { lineRange: { start: 1, end: 3 } },
              })
            )
          );
          await wait(0);
        });
      } catch (error) {
        errors.push(error);
      }
      expect(String(errors[0])).toContain(
        'SnippetFileDiff: snippets cannot render inside a <Virtualizer>'
      );
      await act(async () => {
        root.unmount();
        await wait(0);
      });
    } finally {
      console.error = originalError;
      await mounted.cleanUp();
    }
  });
});
