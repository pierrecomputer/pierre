import { afterAll, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { mockFiles } from './mocks';

afterAll(disposeHighlighter);

describe('FileRenderer HTML', () => {
  test('renders matching gutter and content rows with line metadata', async () => {
    const renderer = new FileRenderer();
    const result = await renderer.asyncRender(mockFiles.file2);
    const fragment = JSDOM.fragment(renderer.renderFullHTML(result));
    const gutter = fragment.querySelector('[data-gutter]')!;
    const content = fragment.querySelector('[data-content]')!;
    const count = mockFiles.file2.contents.split('\n').length;
    expect(result.totalLines).toBe(count);
    expect(gutter.tagName).toBe('DIV');
    expect(content.tagName).toBe('DIV');
    expect(gutter.children).toHaveLength(count);
    expect(content.children).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      expect(content.children[i].tagName).toBe('DIV');
      expect(content.children[i].getAttribute('data-line')).toBe(String(i + 1));
      expect(content.children[i].getAttribute('data-line-type')).toBe(
        'context'
      );
      expect(content.children[i].getAttribute('data-line-index')).toBe(
        String(i)
      );
      expect(gutter.children[i].tagName).toBe('DIV');
      expect(gutter.children[i].getAttribute('data-column-number')).toBe(
        String(i + 1)
      );
      expect(gutter.children[i].getAttribute('data-line-type')).toBe('context');
      expect(gutter.children[i].getAttribute('data-line-index')).toBe(
        String(i)
      );
    }
  });

  test('highlights keywords using both theme variables', async () => {
    const renderer = new FileRenderer();
    const result = await renderer.asyncRender(mockFiles.file2);
    const fragment = JSDOM.fragment(renderer.renderFullHTML(result));
    const token = Array.from(
      fragment.querySelectorAll('[data-content] span')
    ).find((el) => el.textContent === 'function');
    expect(token?.getAttribute('style')).toMatch(
      /--diffs-token-dark:#[A-F0-9]{6};--diffs-token-light:#[A-F0-9]{6}/
    );
  });

  test('counts all lines of the TypeScript fixture', async () => {
    const result = await new FileRenderer().asyncRender(mockFiles.file1);
    expect(result.totalLines).toBe(mockFiles.file1.contents.split('\n').length);
  });

  test('retains the empty trailing line', async () => {
    const renderer = new FileRenderer();
    const result = await renderer.asyncRender({
      name: 'single-line.txt',
      contents: 'hello\n',
    });
    const column = renderer.renderCode(result);
    expect(result.totalLines).toBe(2);
    expect(result.rowCount).toBe(2);
    expect(column.gutter).toHaveLength(2);
    expect(column.content).toHaveLength(2);
  });

  test('keeps the non-worker css field empty', async () => {
    expect((await new FileRenderer().asyncRender(mockFiles.file2)).css).toBe(
      ''
    );
  });

  test('renders file annotations before line one', async () => {
    const renderer = new FileRenderer<string>();
    renderer.setLineAnnotations([
      { lineNumber: 0, metadata: 'file' },
      { lineNumber: 2, metadata: 'line' },
    ]);
    const result = await renderer.asyncRender(mockFiles.file2);
    const fragment = JSDOM.fragment(renderer.renderFullHTML(result));
    const content = fragment.querySelector('[data-content]')!;
    expect(content.children[0].getAttribute('data-line-annotation')).toBe(
      '-1,-1'
    );
    expect(
      Array.from(content.children[0].querySelectorAll('slot'), (el) => el.name)
    ).toEqual(['annotation-0']);
    expect(content.children[1].getAttribute('data-line')).toBe('1');
    expect(
      fragment
        .querySelector('[data-gutter]')
        ?.children[0].getAttribute('data-gutter-buffer')
    ).toBe('annotation');
  });

  test('omits file annotations in windows below the first line', async () => {
    const renderer = new FileRenderer<string>();
    renderer.setLineAnnotations([{ lineNumber: 0, metadata: 'file' }]);
    const result = await renderer.asyncRender(mockFiles.file2, {
      startingLine: 1,
      totalLines: 2,
      bufferBefore: 0,
      bufferAfter: 0,
    });
    const fragment = JSDOM.fragment(renderer.renderFullHTML(result));
    expect(
      fragment
        .querySelector('[data-content]')
        ?.children[0].getAttribute('data-line')
    ).toBe('2');
    expect(fragment.querySelector('[data-line-annotation="-1,-1"]')).toBeNull();
  });

  test('renders pre attributes without adding a tab stop', async () => {
    const renderer = new FileRenderer();
    const result = await renderer.asyncRender(mockFiles.file2);
    const pre = JSDOM.fragment(renderer.renderFullHTML(result)).querySelector(
      'pre'
    )!;
    expect(pre.getAttribute('data-file')).toBe('');
    expect(pre.hasAttribute('data-diff')).toBe(false);
    expect(pre.getAttribute('data-overflow')).toBe('scroll');
    expect(pre.hasAttribute('tabindex')).toBe(false);
    expect(pre.getAttribute('style')).toBe(
      `--diffs-min-number-column-width-default:${String(result.totalLines).length}ch;`
    );
  });
});
