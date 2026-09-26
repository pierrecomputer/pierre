import { afterAll, describe, expect, test } from 'bun:test';
import { toHtml } from 'hast-util-to-html';
import { JSDOM } from 'jsdom';

import {
  DiffHunksRenderer,
  disposeHighlighter,
  FileRenderer,
  getSharedHighlighter,
  parseDiffFromFile,
  renderFileWithHighlighter,
} from '../src';
import { preloadFile, preloadFileDiff } from '../src/ssr';
import { renderTokenLines } from '../src/utils/renderTokenLines';
import {
  createInitializingManager,
  installAnimationFramePolyfill,
} from './workerPoolHarness';

afterAll(disposeHighlighter);

const file = {
  name: 'example.ts',
  contents: 'const answer = "🚀";\r\n\r\nanswer;\n',
};
const modified = {
  ...file,
  contents: file.contents.replace('answer', 'result'),
};

describe('backend rendering', () => {
  for (const preferredHighlighter of [
    'shiki-js',
    'shiki-wasm',
    'highlights',
  ] as const) {
    test(`${preferredHighlighter} exposes absolute offsets and decorates later lines`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const code = 'first\r\n\r\nconst rocket = "🚀";\nlast';
      for (const lang of ['text', 'typescript']) {
        const { tokens } = highlighter.codeToTokens(code, {
          lang,
          theme: 'pierre-dark',
        });
        expect(tokens[2][0].offset).toBe(code.indexOf('const'));
        expect(tokens[3][0].offset).toBe(code.indexOf('last'));
        for (const token of tokens.flat()) {
          expect(
            code.slice(token.offset, token.offset + token.content.length)
          ).toBe(token.content);
        }
        const start = code.indexOf('🚀');
        const fragment = JSDOM.fragment(
          highlighter.codeToHtml(code, {
            lang,
            theme: 'pierre-dark',
            decorations: [
              { start, end: start + 2, properties: { class: 'emoji' } },
            ],
          })
        );
        expect(fragment.querySelectorAll('.emoji')).toHaveLength(1);
        expect(fragment.querySelector('.emoji')?.textContent).toBe('🚀');
      }
    });

    test(`${preferredHighlighter} preserves empty decorations and blank lines`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      for (const code of ['const answer = 42;', '', 'a\n\nb', '\n\n']) {
        const decorations = [
          {
            start: 0,
            end: code.length,
            properties: { class: 'outer' },
            alwaysWrap: true,
          },
          ...(code.length > 6
            ? [
                {
                  start: 0,
                  end: 6,
                  properties: { class: 'left' },
                  alwaysWrap: true,
                },
                {
                  start: 6,
                  end: code.length,
                  properties: { class: 'right' },
                  alwaysWrap: true,
                },
              ]
            : []),
          ...Array.from({ length: code.length + 1 }, (_, offset) => ({
            start: offset,
            end: offset,
            properties: { 'data-marker': offset },
            alwaysWrap: true,
          })),
        ];
        for (const ordered of [decorations, decorations.toReversed()]) {
          const fragment = JSDOM.fragment(
            highlighter.codeToHtml(code, {
              lang: 'typescript',
              theme: 'pierre-dark',
              decorations: ordered,
            })
          );
          expect(fragment.querySelector('code')?.textContent).toBe(code);
          const markers = fragment.querySelectorAll('[data-marker]');
          expect(markers).toHaveLength(code.length + 1);
          for (const [offset, marker] of markers.entries()) {
            expect(marker.getAttribute('data-marker')).toBe(String(offset));
            expect(marker.textContent).toBe('');
            if (code.length > 0)
              expect(marker.closest('.outer')).not.toBeNull();
            const preceding = fragment.ownerDocument.createRange();
            preceding.setStart(fragment.querySelector('code')!, 0);
            preceding.setEndBefore(marker);
            expect(preceding.toString()).toBe(code.slice(0, offset));
          }
          for (const line of fragment.querySelectorAll('.line')) {
            expect(line.querySelectorAll('.outer')).toHaveLength(1);
          }
          if (code.length > 6) {
            expect(fragment.querySelectorAll('.left')).toHaveLength(1);
            expect(fragment.querySelector('.left')?.textContent).toBe(
              code.slice(0, 6)
            );
            expect(fragment.querySelectorAll('.right')).toHaveLength(1);
            expect(fragment.querySelector('.right')?.textContent).toBe(
              code.slice(6)
            );
          }
        }
      }
    });

    test(`${preferredHighlighter} places decorations on blank CRLF and mixed-ending lines`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      for (const [code, offset, line] of [
        ['\r\n\r\nx', 2, 1],
        ['\r\n\r\n', 2, 1],
        ['\r\n\r\n', 4, 2],
        ['a\n\nb\r\n\r\nc', 6, 3],
        ['a\r\n\r\nb\n\nc', 7, 3],
        ['a\rb\n\nc', 5, 2],
      ] as const) {
        for (const lang of ['text', 'typescript']) {
          const fragment = JSDOM.fragment(
            highlighter.codeToHtml(code, {
              lang,
              theme: 'pierre-dark',
              decorations: [
                {
                  start: offset,
                  end: offset,
                  properties: { class: 'marker' },
                  alwaysWrap: true,
                },
              ],
            })
          );
          expect(fragment.querySelectorAll('.marker')).toHaveLength(1);
          expect(
            fragment.querySelectorAll('.line')[line].querySelector('.marker')
          ).not.toBeNull();
        }
      }
    });

    test(`${preferredHighlighter} preserves nested decorations across tokens`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark'],
        langs: ['typescript'],
      });
      const code = 'const answer = 42;';
      const decorations = [
        { start: 0, end: code.length, properties: { class: 'outer' } },
        { start: 6, end: 17, properties: { class: 'inner' } },
        { start: 15, end: 17, properties: { class: 'number' } },
      ];
      for (const ordered of [decorations, decorations.toReversed()]) {
        const fragment = JSDOM.fragment(
          highlighter.codeToHtml(code, {
            lang: 'typescript',
            theme: 'pierre-dark',
            decorations: ordered,
          })
        );
        expect(fragment.querySelectorAll('.outer')).toHaveLength(1);
        expect(fragment.querySelectorAll('.inner')).toHaveLength(1);
        expect(fragment.querySelectorAll('.number')).toHaveLength(1);
        expect(fragment.querySelector('.outer')?.textContent).toBe(code);
        expect(fragment.querySelector('.outer .inner')?.textContent).toBe(
          'answer = 42'
        );
        expect(fragment.querySelector('.inner .number')?.textContent).toBe(
          '42'
        );
      }
    });

    test(`${preferredHighlighter} renders files, diffs and SSR`, async () => {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: ['pierre-dark', 'pierre-light'],
        langs: ['typescript'],
      });
      const highlighted = renderFileWithHighlighter(file, highlighter, {
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        tokenizeMaxLineLength: 1000,
        useTokenTransformer: true,
      });
      const html = toHtml(highlighted.code);
      expect(highlighted.code).toHaveLength(4);
      expect(html).toContain('data-char="0"');
      expect(html).toContain('<br>');
      expect(html).toContain('--diffs-token-dark:');
      expect(html).toContain('--diffs-token-light:');
      const options = {
        preferredHighlighter,
        theme: 'pierre-dark',
        useTokenTransformer: true,
      };
      const [plain, diff] = await Promise.all([
        preloadFile({ file, options }),
        preloadFileDiff({
          fileDiff: parseDiffFromFile(file, modified),
          options,
        }),
      ]);
      expect(plain.prerenderedHTML).toContain('🚀');
      expect(diff.prerenderedHTML).toContain('data-diff-span');
      expect(diff.prerenderedHTML).toContain('result');
    });

    test(`${preferredHighlighter} serializes backend themes for workers`, async () => {
      const restore = installAnimationFramePolyfill();
      const { initialization, manager, worker } = createInitializingManager({
        preferredHighlighter,
        theme: 'pierre-dark',
        langs: ['typescript'],
      });
      try {
        const request = await worker.waitForInitializeRequest();
        expect(request.preferredHighlighter).toBe(preferredHighlighter);
        expect(request.resolvedThemes[0].name).toBe('pierre-dark');
        if (preferredHighlighter === 'highlights')
          expect(request.resolvedLanguages).toEqual([]);
        worker.respond({
          type: 'success',
          requestType: 'initialize',
          id: request.id,
          sentAt: Date.now(),
        });
        await initialization;
        expect(manager.getPreferredHighlighter()).toBe(preferredHighlighter);
      } finally {
        manager.terminate();
        restore();
      }
    });
  }

  test('renderers can change backend after their first render', async () => {
    const options = {
      theme: 'pierre-dark',
      preferredHighlighter: 'shiki-js',
    } as const;
    const fileRenderer = new FileRenderer(options);
    const diffRenderer = new DiffHunksRenderer(options);
    const diff = parseDiffFromFile(file, modified);
    try {
      await fileRenderer.asyncRender(file);
      await diffRenderer.asyncRender(diff);
      fileRenderer.setOptions({
        ...options,
        preferredHighlighter: 'highlights',
      });
      diffRenderer.setOptions({
        ...options,
        preferredHighlighter: 'highlights',
      });
      expect(await fileRenderer.asyncRender(file)).toBeDefined();
      expect(await diffRenderer.asyncRender(diff)).toBeDefined();
      expect((await fileRenderer.initializeHighlighter()).name).toBe(
        'highlights'
      );
      expect((await diffRenderer.initializeHighlighter()).name).toBe(
        'highlights'
      );
    } finally {
      fileRenderer.cleanUp();
      diffRenderer.cleanUp();
    }
  });
});

test('empty decorated editor lines retain their caret placeholder', () => {
  const fragment = JSDOM.fragment(
    toHtml(
      renderTokenLines([[]], {
        useTokenTransformer: true,
        decorations: [
          {
            start: 0,
            end: 0,
            properties: { class: 'marker' },
            alwaysWrap: true,
          },
        ],
      })
    )
  );
  expect(fragment.querySelectorAll('.marker')).toHaveLength(1);
  expect(fragment.querySelectorAll('br')).toHaveLength(1);
});
