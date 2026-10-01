import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import type { Element, ElementContent, Nodes, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { createGutterUtilityElement } from '../src/utils/createGutterUtilityElement';
import { hastToHtml } from '../src/utils/hastToHtml';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { fileNew, fileOld, mockFiles } from './mocks';

// Each test loads its backend fresh: only one highlighter type can be loaded.
beforeEach(disposeHighlighter);
afterAll(disposeHighlighter);

// hastToHtml replaces toHtml on the rendering hot paths, so its output must
// match byte for byte, including every fallback to toHtml.
function expectSameHtml(tree: Nodes | RootContent[]): void {
  expect(hastToHtml(tree)).toBe(toHtml(tree));
}

function span(
  properties: Element['properties'],
  children: ElementContent[] = []
): Element {
  return { type: 'element', tagName: 'span', properties, children };
}

describe('hastToHtml', () => {
  test('escapes text and attribute values like toHtml', () => {
    expectSameHtml([
      { type: 'text', value: 'a < b && c > d "quoted" \'single\' `tick`' },
      span({
        style: 'content:"<&>"; font-family:\'x\'; `\0`',
        'data-value': 'a"b&c\'d`e<f>g',
      }),
      span({ title: '' }, [{ type: 'text', value: '' }]),
    ]);
  });

  test('matches toHtml for attribute value types', () => {
    expectSameHtml(
      span({
        'data-true': true,
        'data-false': false,
        'data-null': null,
        'data-undefined': undefined,
        'data-number': 42,
        'data-zero': 0,
        'data-nan': Number.NaN,
        'data-empty': '',
        'data-list': ['a', 'b', ' c '],
        'data-dotted.name:x': 'value',
        className: ['token', 'keyword'],
        id: 'identifier',
        role: 'separator',
        tabIndex: 0,
      })
    );
    expectSameHtml(span({ class: 'line' }));
    expectSameHtml(span({ class: [] }));
    expectSameHtml(span({ className: true }));
  });

  test('serializes single-text token spans without dropping extra attributes', () => {
    const children: ElementContent[] = [{ type: 'text', value: 'a < b && c' }];
    for (const properties of [
      { style: 'color:red' },
      { style: '' },
      { style: 'content:"\0\u0060\'<&>"' },
      { style: 'color:red', title: null, 'data-unused': undefined },
      { style: 'color:red', 'data-char': 0 },
      { 'data-char': 42, style: 'color:red' },
      { style: 'color:red', className: ['token', 'keyword'] },
      { style: 'color:red', hidden: true },
      { style: false },
      { style: true },
      { style: ['color:red', 'font-weight:bold'] },
    ]) {
      expectSameHtml(span(properties, children));
    }
    expectSameHtml(
      span({ style: 'color:red' }, [
        ...children,
        { type: 'text', value: ' > d' },
      ])
    );
  });

  test('matches toHtml with repeated and more than 256 distinct styles', () => {
    const children: ElementContent[] = [{ type: 'text', value: '<&' }];
    const spans: RootContent[] = [];
    for (let i = 0; i < 300; i++) {
      spans.push(span({ style: `--token:${i};content:"&"` }, children));
    }
    spans.push(span({ style: '--token:0;content:"&"' }, children));
    spans.push(span({ style: '--token:299;content:"&"' }, children));
    expectSameHtml(spans);

    const token = span({ style: 'color:red' }, children);
    expectSameHtml(token);
    token.properties.style = 'color:blue';
    expectSameHtml(token);
  });

  test('closes void elements only when they have no content', () => {
    expectSameHtml([
      { type: 'element', tagName: 'br', properties: {}, children: [] },
      {
        type: 'element',
        tagName: 'BR',
        properties: { 'data-x': 1 },
        children: [],
      },
      {
        type: 'element',
        tagName: 'img',
        properties: {},
        children: [{ type: 'text', value: 'x' }],
      },
      { type: 'element', tagName: 'div', properties: {}, children: [] },
    ]);
  });

  test('defers schema-dependent nodes and attributes to toHtml', () => {
    expectSameHtml([
      span({ hidden: true, 'aria-hidden': 'true', role: 'button' }, [
        { type: 'text', value: '<hidden>' },
      ]),
      span({ dataFoo: 'camel', 'DATA-upper': 'x' }),
      {
        type: 'element',
        tagName: 'style',
        properties: {},
        children: [{ type: 'text', value: 'a > b { color: "&" }' }],
      },
      {
        type: 'element',
        tagName: 'script',
        properties: { type: 'module' },
        children: [{ type: 'text', value: 'if (a < b && c) {}' }],
      },
      {
        type: 'element',
        tagName: 'svg',
        properties: {
          viewBox: '0 0 16 16',
          xmlns: 'http://www.w3.org/2000/svg',
        },
        children: [
          {
            type: 'element',
            tagName: 'use',
            properties: { href: '#icon', xLinkHref: '#icon' },
            children: [],
          },
        ],
      },
      { type: 'comment', value: ' note ' },
      {
        type: 'element',
        tagName: 'div',
        properties: { 'data-outer': '' },
        children: [
          span({ style: 'color:red' }, [{ type: 'text', value: 'x' }]),
        ],
      },
    ]);
    expectSameHtml({
      type: 'root',
      children: [{ type: 'doctype' }, span({ 'data-a': 'b' })],
    });
    expectSameHtml(createGutterUtilityElement());
  });

  const backends = ['shiki-js', 'highlights'] as const;
  for (const preferredHighlighter of backends) {
    for (const useTokenTransformer of [false, true]) {
      const label = `${preferredHighlighter}${useTokenTransformer ? ' with token transformer' : ''}`;

      test(`matches toHtml for rendered files (${label})`, async () => {
        const renderer = new FileRenderer({
          theme: { dark: 'pierre-dark', light: 'pierre-light' },
          preferredHighlighter,
          useTokenTransformer,
        });
        renderer.setLineAnnotations([{ lineNumber: 2, metadata: undefined }]);
        try {
          const result = await renderer.asyncRender(mockFiles.file1);
          expectSameHtml(renderer.renderFullAST(result));
          if (result.headerAST != null) expectSameHtml(result.headerAST);
        } finally {
          renderer.cleanUp();
        }
      });

      for (const diffStyle of ['split', 'unified'] as const) {
        test(`matches toHtml for rendered ${diffStyle} diffs (${label})`, async () => {
          const renderer = new DiffHunksRenderer({
            theme: 'pierre-dark',
            preferredHighlighter,
            useTokenTransformer,
            diffStyle,
            lineDiffType: 'word-alt',
          });
          try {
            const result = await renderer.asyncRender(
              parseDiffFromFile(
                { name: 'file.ts', contents: fileOld },
                { name: 'file.ts', contents: fileNew }
              )
            );
            expectSameHtml(renderer.renderFullAST(result));
            if (result.headerElement != null)
              expectSameHtml(result.headerElement);
          } finally {
            renderer.cleanUp();
          }
        });
      }
    }
  }
});
