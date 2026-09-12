import { expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';

import { createHtmlElement, createTextNode, toHtml } from '../src/utils/html';

test('source text and attribute values cannot create HTML elements', () => {
  expect(
    toHtml(
      createHtmlElement({
        tagName: 'span',
        properties: {
          title: '"<&>',
          'data-line': 2,
          'data-empty': '',
          hidden: false,
          disabled: true,
        },
        children: [createTextNode('<script>"&</script>')],
      })
    )
  ).toBe(
    '<span title="&quot;&lt;&amp;&gt;" data-line="2" data-empty="" disabled>&lt;script&gt;&quot;&amp;&lt;/script&gt;</span>'
  );
});

test('CSS remains raw text without allowing a closing style tag', () => {
  expect(
    toHtml(
      createHtmlElement({
        tagName: 'style',
        children: [createTextNode('span > b { content: "</style><script>"; }')],
      })
    )
  ).toBe('<style>span > b { content: "\\3c /style><script>"; }</style>');
});

test('SVG attributes retain their case and void elements have no closing tag', () => {
  expect(
    toHtml([
      createHtmlElement({
        tagName: 'svg',
        properties: { viewBox: '0 0 16 16' },
      }),
      { type: 'element', tagName: 'br', properties: {}, children: [] },
    ])
  ).toBe('<svg viewBox="0 0 16 16"></svg><br>');
});

test('malformed attribute names cannot create additional attributes or elements', () => {
  expect(
    toHtml(
      createHtmlElement({
        tagName: 'span',
        properties: {
          'x" onmouseover': 'alert(1)',
          'x><script>alert(1)</script': '',
          'x=onclick': 'alert(1)',
          '': '',
          '\0onclick': 'alert(1)',
          title: 'safe',
        },
      })
    )
  ).toBe('<span title="safe"></span>');
});

test('malformed tag names render only their escaped children', () => {
  expect(
    toHtml({
      type: 'element',
      tagName: 'img src=x onerror=alert(1)',
      properties: {},
      children: [createTextNode('<source>')],
    })
  ).toBe('&lt;source&gt;');
});

test('comment nodes preserve text without allowing HTML to break out', () => {
  expect(
    toHtml(
      createHtmlElement({
        tagName: 'span',
        children: [{ type: 'comment', value: '<note> & "quote"' }],
      })
    )
  ).toBe('<span><!--<note> & "quote"--></span>');

  for (const value of ['>', '->', '<!--', '-->', '--!>', '<!-']) {
    const fragment = JSDOM.fragment(
      toHtml({ type: 'comment', value: `${value}<script>alert(1)</script>` })
    );
    expect(fragment.querySelectorAll('*')).toHaveLength(0);
    expect(fragment.childNodes).toHaveLength(1);
    expect(fragment.firstChild?.nodeType).toBe(8);
  }
});

test('property aliases preserve accessible HTML and SVG attributes', () => {
  expect(
    toHtml(
      createHtmlElement({
        tagName: 'svg',
        properties: {
          className: ['icon', 'active'],
          tabIndex: 0,
          ariaLabel: 'Review',
          ariaDescribedBy: 'description',
          ariaMultiLine: false,
          dataLineIndex: 3,
          viewBox: '0 0 16 16',
          preserveAspectRatio: 'xMidYMid meet',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeDasharray: '2 4',
          fillRule: 'evenodd',
          xLinkHref: '#icon',
          xmlLang: 'en',
        },
      })
    )
  ).toBe(
    '<svg class="icon active" tabindex="0" aria-label="Review" aria-describedby="description" aria-multiline="false" data-line-index="3" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" stroke-width="2" stroke-linecap="round" stroke-dasharray="2 4" fill-rule="evenodd" xlink:href="#icon" xml:lang="en"></svg>'
  );
});

test('hidden retains its until-found behavior', () => {
  expect(
    toHtml(
      createHtmlElement({
        tagName: 'div',
        properties: { hidden: 'until-found' },
      })
    )
  ).toBe('<div hidden="until-found"></div>');
});
