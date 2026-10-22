import pierreDark from '@pierre/highlights/themes/pierre-dark';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import {
  createMarkdownSession,
  renderToElements,
  renderToHtml,
} from '@pierre/markdowns';
import type { MarkdownNode } from '@pierre/markdowns';
import { afterEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, useEffect } from 'react';
import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';

import { createHighlightsPlugin } from '../react/highlights';
import { Markdown } from '../react/react';
import { defaultUrlTransform } from '../react/react';
import type { Components, ExtraProps } from '../react/react';

const decoder = new TextDecoder();
const html = (
  source: string,
  props: Partial<Parameters<typeof Markdown>[0]> = {}
): string => renderToStaticMarkup(<Markdown {...props}>{source}</Markdown>);
const flatten = (nodes: MarkdownNode[]): string =>
  nodes
    .map((node) => (node.type === 'text' ? node.value : flatten(node.children)))
    .join('');
let root: Root | undefined;
let dom: JSDOM | undefined;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

/** Install a small DOM only for lifecycle, hydration, and node-identity checks. */
function mountDOM(markup = ''): HTMLElement {
  dom = new JSDOM(`<div id="app">${markup}</div>`, {
    url: 'https://example.com',
  });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return document.getElementById('app')!;
}
afterEach(async () => {
  if (root !== undefined) {
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = undefined;
  }
  dom?.window.close();
  dom = undefined;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
});

describe('WAT structured output', () => {
  test('owns its strings and decodes generated entities exactly once', () => {
    const nodes = renderToElements(
      'é **中 &amp; &lt; &amp;lt;** ![alt &quot;x&quot;](/img)'
    );
    const before = JSON.stringify(nodes);
    renderToHtml('another document'.repeat(20000));
    expect(JSON.stringify(nodes)).toBe(before);
    expect(flatten(nodes)).toContain('中 & < &lt;');
    expect(JSON.stringify(nodes)).toContain(
      'alt \\"x\\"'.replaceAll('\\\\', '\\')
    );
  });
  test('structured output excludes raw HTML while preserving ordinary inline text', () => {
    expect(
      flatten(renderToElements('Hello <span onclick="bad()">world</span>'))
    ).toBe('Hello world');
    expect(renderToElements('<img src=x onerror="bad()">')).toEqual([]);
    expect(
      decoder.decode(renderToHtml('<img src=x onerror="bad()">'))
    ).toContain('onerror');
  });
  test('large event tapes survive memory growth and remain usable', () => {
    const nodes = renderToElements(
      Array.from({ length: 5000 }, (_, i) => `**row ${i}** & text\n\n`).join('')
    );
    expect(nodes).toHaveLength(5000);
    expect(flatten(nodes.slice(-1))).toBe('row 4999 & text');
    expect(flatten(renderToElements('# again'))).toBe('again');
  });
  test('tables, tasks, links, and footnotes produce structured elements', () => {
    const nodes = renderToElements(
      '- [x] Done\n\n| A | B |\n|---|---|\n|x|y|\n\nNote[^1]\n\n[^1]: Detail'
    );
    const serialized = JSON.stringify(nodes);
    expect(serialized).toContain('"tagName":"table"');
    expect(serialized).toContain('"checked":""');
    expect(serialized).toContain('footnote-ref');
  });
});

describe('streaming display completion', () => {
  for (const [source, marker] of [
    ['**bold', 'strong'],
    ['*italic', 'em'],
    ['~~gone', 'del'],
    ['`code', 'code'],
    ['``code', 'code'],
    ['**bold *and italic', 'em'],
  ]) {
    test(`completes ${JSON.stringify(source)}`, () => {
      expect(html(source)).toContain(`<${marker}`);
      expect(html(source, { mode: 'static' })).not.toContain(`<${marker}`);
    });
  }
  test('repairs partial links as text, then enables the completed destination', () => {
    expect(html('[Hello](https://exam')).not.toContain('href=');
    expect(html('[Hello](https://exam')).toContain('Hello');
    expect(html('[Hello')).not.toContain('[Hello');
    expect(html('[Hello](https://example.com)')).toContain(
      'href="https://example.com"'
    );
    expect(html('![unfinished](https://exam')).not.toContain('<img');
  });
  test('protects code, escaped delimiters, intraword names, and complete formatting', () => {
    for (const source of [
      '**bold**',
      '\\*literal',
      'some_variable_name',
      '1 < 3',
      '`\\`',
      '`**literal`',
      '```js\nconst x = "**literal"',
    ]) {
      expect(flatten(renderToElements(source, { incomplete: true }))).toBe(
        flatten(renderToElements(source))
      );
    }
  });
  test('protects nested fences and reports their completion from the block parser', () => {
    for (const source of [
      '> ```js\n> **literal',
      '- item\n\n  ```js\n  **literal',
    ]) {
      expect(flatten(renderToElements(source, { incomplete: true }))).toBe(
        flatten(renderToElements(source))
      );
      expect(html(source, { isAnimating: true })).toContain('disabled=""');
    }
    const source = 'Note[^1]\n\n[^1]: earlier\n\n```js\n**literal';
    expect(html(source, { isAnimating: true })).toContain('disabled=""');
  });
  test('completion survives adversarial delimiter sequences and renderer reuse', () => {
    let seed = 7;
    const alphabet = '*_~`[]()<>!\\\n ab12';
    for (let i = 0; i < 300; i++) {
      let source = '';
      for (let j = 0; j < 128; j++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        source += alphabet[seed % alphabet.length];
      }
      const first = renderToElements(source, { incomplete: true });
      expect(renderToElements(source, { incomplete: true })).toEqual(first);
    }
  });
  test('closed fences become interactive while the message is still streaming', () => {
    expect(html('```js\nhello', { isAnimating: true })).toContain(
      'disabled=""'
    );
    expect(html('```js\nhello\n```', { isAnimating: true })).not.toContain(
      'disabled=""'
    );
  });
  test('completion is opt-out and static mode preserves exact Markdown behavior', () => {
    expect(html('**hello', { parseIncompleteMarkdown: false })).toContain(
      '**hello'
    );
    expect(
      html('**hello', { mode: 'static', isAnimating: true, caret: 'block' })
    ).not.toContain('data-markdown="caret"');
  });
});

describe('React rendering and security', () => {
  test('filters raw HTML, event handlers, dangerous schemes and transformed URLs', () => {
    const output = html(
      '[bad](javascript:alert(1))\n\n![bad](data:image/svg+xml,bad)\n\n<img src=x onerror="bad()">'
    );
    expect(output).not.toContain('javascript:');
    expect(output).not.toContain('data:image');
    expect(output).not.toContain('onerror');
    expect(
      html('[safe](https://example.com)', {
        urlTransform: () => 'javascript:alert(1)',
      })
    ).not.toContain('href=');
    for (const url of [
      'javascript:bad()',
      'jav\tascript:bad()',
      'data:text/html,bad',
      '//evil.test',
      '\\evil.test',
    ])
      expect(defaultUrlTransform(url)).toBeUndefined();
    for (const url of [
      'https://example.com',
      '/docs',
      '#section',
      'mailto:a@example.com',
    ])
      expect(defaultUrlTransform(url)).toBe(url);
  });
  test('supports React overrides with normalized attributes and nested children', () => {
    const components: Components = {
      a: ({ href, children, node }) => (
        <button data-href={href} data-tag={node.tagName}>
          {children}
        </button>
      ),
    };
    expect(html('[**Hello**](/docs)', { components })).toContain(
      '<button data-href="/docs" data-tag="a"><strong'
    );
    expect(
      html('`hello`', {
        components: { inlineCode: ({ children }) => <mark>{children}</mark> },
      })
    ).toContain('<mark>hello</mark>');
  });
  test('keeps inline and fenced code overrides separate inside custom pre elements', () => {
    const components: Components = {
      pre: ({ children }) => <pre>{children}</pre>,
      inlineCode: ({ children }) => <mark>{children}</mark>,
      code: ({ children, inline }) => (
        <code data-inline={String(inline)}>{children}</code>
      ),
    };
    const output = html('`inline`\n\n```text\nfenced\n```', { components });
    expect(output).toContain('<mark>inline</mark>');
    expect(output).toContain('<code data-inline="false">fenced');
  });
  test('supports filtering, unwrapping, and optional code controls', () => {
    expect(html('**hello**', { disallowedElements: ['strong'] })).not.toContain(
      'hello'
    );
    expect(
      html('**hello**', {
        disallowedElements: ['strong'],
        unwrapDisallowed: true,
      })
    ).toContain('hello');
    expect(
      html('```text\nhello\n```', { controls: false, lineNumbers: false })
    ).not.toContain('<button');
    expect(() =>
      html('hello', { allowedElements: ['p'], disallowedElements: ['a'] })
    ).toThrow();
  });
  test('adapts Highlights and falls back cleanly for unknown languages', () => {
    const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };
    expect(html('```js\nconst x = 1\n```', { plugins })).toContain(
      'style="color:'
    );
    expect(html('```imaginary-language\nhello\n```', { plugins })).toContain(
      'hello'
    );
  });
  test('hydrates server-rendered output without mismatches', async () => {
    const source = '| A | B |\n|---|---|\n|x|y|\n\nA[^1]\n\n[^1]: Note';
    const element = <Markdown>{source}</Markdown>;
    const container = mountDOM(renderToString(element));
    const errors: unknown[] = [];
    await act(async () => {
      await Promise.resolve();
      root = hydrateRoot(container, element, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    const reference = container.querySelector('a[data-footnote-ref]')!;
    expect(
      container.querySelector(
        `[id="${reference.getAttribute('href')!.slice(1)}"]`
      )
    ).not.toBeNull();
  });
  test('keeps completed blocks mounted and resolves late reference definitions', async () => {
    const container = mountDOM();
    let mounts = 0;
    function Paragraph({ children }: ComponentPropsForParagraph): ReactNode {
      useEffect(() => {
        mounts++;
      }, []);
      return <p>{children}</p>;
    }
    const components: Components = { p: Paragraph };
    await act(async () => {
      await Promise.resolve();
      root = createRoot(container);
      root.render(
        <Markdown components={components}>
          {'Stable paragraph\n\nSee [guide][ref]\n\nTail'}
        </Markdown>
      );
    });
    const first = container.querySelector('p');
    const initialMounts = mounts;
    await act(async () => {
      await Promise.resolve();
      root?.render(
        <Markdown components={components}>
          {'Stable paragraph\n\nSee [guide][ref]\n\nTail grows\n\n[ref]: /docs'}
        </Markdown>
      );
    });
    expect(container.querySelector('p')).toBe(first);
    expect(mounts).toBe(initialMounts);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/docs');
  });
});
describe('cached block metadata', () => {
  test('serializes reused blocks once while updating changed blocks and render configuration', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const originalStringify = JSON.stringify;
    let completedSerializations = 0;
    let tailSerializations = 0;
    JSON.stringify = ((value: unknown, ...args: unknown[]) => {
      if (
        value !== null &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'element' &&
        'children' in value
      ) {
        const child = (value.children as { value?: string }[])[0]?.value;
        if (child === 'Completed paragraph') completedSerializations++;
        if (child?.startsWith('Tail') === true) tailSerializations++;
      }
      return Reflect.apply(originalStringify, JSON, [value, ...args]);
    }) as typeof JSON.stringify;
    const render = async (
      source: string,
      components?: Components
    ): Promise<void> => {
      await act(async () => {
        root?.render(<Markdown components={components}>{source}</Markdown>);
        await Promise.resolve();
      });
    };
    try {
      await render('Completed paragraph\n\nTail');
      await render('Completed paragraph\n\nTail grows');
      const paragraph = container.querySelector('p');
      const completedBeforeAppend = completedSerializations;
      const tailBeforeAppend = tailSerializations;
      await render('Completed paragraph\n\nTail grows again');
      expect(completedSerializations).toBe(completedBeforeAppend);
      expect(tailSerializations).toBeGreaterThan(tailBeforeAppend);
      expect(container.querySelector('p')).toBe(paragraph);
      expect(container.textContent).toContain('Tail grows again');
      await render('Completed paragraph\n\nTail grows again', {
        p: ({ children }) => <p data-custom="updated">{children}</p>,
      });
      expect(completedSerializations).toBe(completedBeforeAppend);
      expect(container.querySelector('p')?.getAttribute('data-custom')).toBe(
        'updated'
      );
    } finally {
      JSON.stringify = originalStringify;
    }
  });
});
describe('settled streaming blocks', () => {
  test('keeps historical paragraph and code renders stable across playback changes', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let historicalParagraphRenders = 0;
    let historicalCodeRenders = 0;
    let tailRenders = 0;
    const components: Components = {
      p: ({ children, node, isIncomplete }) => {
        const historical = flatten(node.children) === 'Completed paragraph';
        if (historical) historicalParagraphRenders++;
        else tailRenders++;
        return (
          <p
            data-history={historical || undefined}
            data-incomplete={isIncomplete}
          >
            {children}
          </p>
        );
      },
      code: ({ children, isIncomplete }) => {
        historicalCodeRenders++;
        return <code data-incomplete={isIncomplete}>{children}</code>;
      },
    };
    const render = async (
      source: string,
      isAnimating: boolean,
      extra: Partial<Parameters<typeof Markdown>[0]> = {}
    ): Promise<void> => {
      await act(async () => {
        root?.render(
          <Markdown
            animated={{ duration: 80 }}
            components={components}
            isAnimating={isAnimating}
            {...extra}
          >
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
    };
    let source = 'Completed paragraph\n\n```text\nfinished code\n```\n\nTail';
    await render(source, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    const historicalParagraph = container.querySelector('p[data-history]');
    const historicalCode = container.querySelector('code');
    const paragraphBefore = historicalParagraphRenders;
    const codeBefore = historicalCodeRenders;
    const tailBefore = tailRenders;
    await render(source, false);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    expect(tailRenders).toBeGreaterThan(tailBefore);
    expect(
      container.querySelector('p:last-child')?.getAttribute('data-incomplete')
    ).toBe('false');
    await render(source, true);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    expect(
      container.querySelector('p:last-child')?.getAttribute('data-incomplete')
    ).toBe('true');
    source += ' grows';
    await render(source, true);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' grows'
    );
    await render(source, false);
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    expect(container.querySelector('p[data-history]')).toBe(
      historicalParagraph
    );
    expect(container.querySelector('code')).toBe(historicalCode);
    expect(container.querySelector('p:last-child')?.textContent).toBe(
      'Tail grows'
    );
    source += ' while paused';
    await render(source, false);
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    expect(container.querySelector('p:last-child')?.textContent).toBe(
      'Tail grows while paused'
    );
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    await render(source, true);
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    source += ' resumes';
    await render(source, true);
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' resumes'
    );
    await render(source, false);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);

    await render(source, false, { controls: false });
    expect(container.querySelector('[aria-label="Copy code"]')).toBeNull();
    await render(source, false, {
      components: {
        ...components,
        p: ({ children }) => <p data-custom="updated">{children}</p>,
      },
    });
    expect(container.querySelector('p')?.getAttribute('data-custom')).toBe(
      'updated'
    );
    await render(
      'Replacement paragraph\n\n```text\nreplacement code\n```',
      false
    );
    expect(container.querySelector('p')?.textContent).toBe(
      'Replacement paragraph'
    );
    expect(container.querySelector('code')?.textContent).toBe(
      'replacement code\n'
    );
  });
  test('stops live historical fades without rerendering their memoized blocks', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let historicalParagraphRenders = 0;
    const components: Components = {
      p: ({ children, node }) => {
        const historical = flatten(node.children) === 'Completed paragraph';
        if (historical) historicalParagraphRenders++;
        return <p data-history={historical || undefined}>{children}</p>;
      },
    };
    const render = async (
      source: string,
      isAnimating: boolean
    ): Promise<void> => {
      await act(async () => {
        root?.render(
          <Markdown
            animated={{ duration: 10_000 }}
            components={components}
            isAnimating={isAnimating}
          >
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
    };
    const source = 'Completed paragraph\n\n```text\nfinished code\n```\n\nTail';
    await render(source, true);
    const paragraph = container.querySelector('p[data-history]')!;
    const code = container.querySelector('[data-markdown="code-block"]')!;
    const selectedToken = paragraph.querySelector('[data-markdown="token"]')!;
    expect(selectedToken.getAttribute('data-animated')).toBe('true');
    expect(code.querySelector('[data-animated="true"]')).not.toBeNull();
    const selectedText = selectedToken.firstChild!;
    const selection = window.getSelection()!;
    await act(async () => {
      const range = document.createRange();
      range.setStart(selectedText, 0);
      range.setEnd(selectedText, 9);
      selection.addRange(range);
      await Promise.resolve();
    });
    const historicalBefore = historicalParagraphRenders;
    await render(source, false);
    expect(historicalParagraphRenders).toBe(historicalBefore);
    expect(paragraph.querySelector('[data-animated="true"]')).toBeNull();
    expect(code.querySelector('[data-animated="true"]')).toBeNull();
    expect(paragraph.querySelector('[data-markdown="token"]')).toBe(
      selectedToken
    );
    expect(selection.anchorNode).toBe(selectedText);
    expect(selection.toString()).toBe('Completed');
    await render(source, true);
    expect(historicalParagraphRenders).toBe(historicalBefore);
    expect(paragraph.querySelector('[data-animated="true"]')).toBeNull();
    expect(code.querySelector('[data-animated="true"]')).toBeNull();
    await render(source + ' grows', true);
    expect(historicalParagraphRenders).toBe(historicalBefore);
    expect(container.querySelector('p[data-history]')).toBe(paragraph);
    expect(container.querySelector('[data-markdown="code-block"]')).toBe(code);
    expect(selection.anchorNode).toBe(selectedText);
    expect(selection.toString()).toBe('Completed');
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' grows'
    );
    await act(async () => {
      selection.removeAllRanges();
      document.dispatchEvent(new window.Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(selectedToken.isConnected).toBe(false);
    expect(paragraph.querySelector('[data-markdown="token"]')).toBeNull();
    expect(paragraph.textContent).toBe('Completed paragraph');
    expect(historicalParagraphRenders).toBe(historicalBefore);
  });
  test('updates an unfinished final code block while settled history stays unchanged', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let historicalParagraphRenders = 0;
    let historicalCodeRenders = 0;
    let liveCodeRenders = 0;
    const components: Components = {
      p: ({ children, node }) => {
        if (flatten(node.children) === 'Completed paragraph')
          historicalParagraphRenders++;
        return <p>{children}</p>;
      },
      code: ({ children, node, isIncomplete }) => {
        if (flatten(node.children).startsWith('finished'))
          historicalCodeRenders++;
        else liveCodeRenders++;
        return <code data-incomplete={isIncomplete}>{children}</code>;
      },
    };
    const render = async (
      source: string,
      isAnimating: boolean
    ): Promise<void> => {
      await act(async () => {
        root?.render(
          <Markdown
            animated={{ duration: 80 }}
            components={components}
            isAnimating={isAnimating}
          >
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
    };
    let source =
      'Completed paragraph\n\n```text\nfinished code\n```\n\n```text\nlive code';
    await render(source, true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    const paragraphBefore = historicalParagraphRenders;
    const codeBefore = historicalCodeRenders;
    const liveBefore = liveCodeRenders;
    const copyButtons = (): HTMLButtonElement[] =>
      Array.from(container.querySelectorAll('[aria-label="Copy code"]'));
    expect(copyButtons().map((button) => button.disabled)).toEqual([
      false,
      true,
    ]);
    await render(source, false);
    expect(copyButtons().map((button) => button.disabled)).toEqual([
      false,
      false,
    ]);
    expect(liveCodeRenders).toBeGreaterThan(liveBefore);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    await render(source, true);
    expect(copyButtons().map((button) => button.disabled)).toEqual([
      false,
      true,
    ]);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    source += '\n```\n\nTail';
    await render(source, true);
    expect(copyButtons().map((button) => button.disabled)).toEqual([
      false,
      false,
    ]);
    expect(
      container.querySelectorAll('code')[1]?.getAttribute('data-incomplete')
    ).toBe('false');
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
    const completedCodeRenders = liveCodeRenders;
    await render(source + ' grows', true);
    await render(source + ' grows', false);
    expect(liveCodeRenders).toBe(completedCodeRenders);
    expect(historicalParagraphRenders).toBe(paragraphBefore);
    expect(historicalCodeRenders).toBe(codeBefore);
  });
});
describe('optional token fade-in', () => {
  for (const custom of [false, true]) {
    test(`keeps ${custom ? 'custom' : 'default'} link labels mounted as their destination arrives`, async () => {
      const container = mountDOM();
      root = createRoot(container);
      let mounts = 0;
      const components: Components | undefined = custom
        ? {
            a: function Link({ children, href }) {
              useEffect(() => {
                mounts++;
              }, []);
              return <a href={href}>{children}</a>;
            },
          }
        : undefined;
      const render = async (source: string): Promise<void> => {
        await act(async () => {
          root?.render(
            <Markdown
              animated={{ duration: 10_000 }}
              isAnimating
              components={components}
            >
              {source}
            </Markdown>
          );
          await Promise.resolve();
        });
      };
      const label = 'See [Hello **world** and `code`';
      await render(label);
      const link = container.querySelector('a')!;
      const tokens = Array.from(
        link.querySelectorAll('[data-markdown="token"]')
      );
      expect(tokens.length).toBeGreaterThan(0);
      const text = tokens[0].firstChild!;
      const selection = document.getSelection()!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      selection.addRange(range);
      for (const suffix of [']', '](', '](https:', '](https://example.com']) {
        await render(label + suffix);
        expect(container.querySelector('a') === link).toBe(true);
        expect(link.hasAttribute('href')).toBe(false);
        const current = Array.from(
          link.querySelectorAll('[data-markdown="token"]')
        );
        expect(current.length).toBe(tokens.length);
        expect(current.every((token, index) => token === tokens[index])).toBe(
          true
        );
        expect(selection.anchorNode === text).toBe(true);
        expect(selection.anchorOffset).toBe(0);
        expect(selection.focusOffset).toBe(5);
        expect(selection.toString()).toBe('Hello');
      }
      await render(label + '](https://example.com) and more');
      expect(container.querySelector('a') === link).toBe(true);
      expect(link.getAttribute('href')).toBe('https://example.com');
      const completedTokens = Array.from(
        link.querySelectorAll('[data-markdown="token"]')
      );
      expect(completedTokens.length).toBe(tokens.length);
      expect(
        completedTokens.every((token, index) => token === tokens[index])
      ).toBe(true);
      for (const token of tokens) {
        expect(token.getAttribute('data-animated')).toBe('true');
        expect(token.getAttribute('style')).toBe(
          'animation-duration: 10000ms;'
        );
      }
      expect(selection.anchorNode === text).toBe(true);
      expect(selection.toString()).toBe('Hello');
      if (custom) expect(mounts).toBe(1);
    });
  }
  test('does not replay settled link labels when a destination completes or is rejected', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const render = async (source: string, active = true): Promise<void> => {
      await act(async () => {
        root?.render(
          <Markdown animated={{ duration: 20 }} isAnimating={active}>
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
    };
    await render('See [guide](');
    const link = container.querySelector('a')!;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(link.querySelector('[data-markdown="token"]')).toBeNull();
    for (const source of [
      'See [guide](https://example.com',
      'See [guide](https://example.com)',
      'See [guide](javascript:alert)',
    ]) {
      await render(source);
      expect(container.querySelector('a')).toBe(link);
      expect(link.querySelector('[data-animated="true"]')).toBeNull();
      expect(link.textContent).toBe('guide');
    }
    expect(link.hasAttribute('href')).toBe(false);
    await render('See [guide](javascript:alert)', false);
    await render('See [guide](javascript:alert)', true);
    expect(container.querySelector('a')).toBe(link);
    expect(link.querySelector('[data-animated="true"]')).toBeNull();
  });
  test('does not add animation spans by default, for static mode, or for idle content', () => {
    expect(html('Hello', { isAnimating: true })).not.toContain(
      'data-markdown="token"'
    );
    expect(html('Hello', { animated: true })).not.toContain(
      'data-markdown="token"'
    );
    expect(
      html('Hello', { animated: true, mode: 'static', isAnimating: true })
    ).not.toContain('data-markdown="token"');
    expect(html('Hello', { animated: true, isAnimating: true })).toContain(
      'animation-duration:180ms'
    );
  });
  test('preserves existing tokens and their timing as text and duration change', async () => {
    const container = mountDOM();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          Hel
        </Markdown>
      );
      await Promise.resolve();
    });
    const first = container.querySelector('[data-markdown="token"]');
    expect(first?.textContent).toBe('Hel');
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          Hello world
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-markdown="token"]')).toBe(first);
    expect(first?.getAttribute('style')).toBe('animation-duration: 10000ms;');
    expect(
      Array.from(
        container.querySelectorAll('[data-animated="true"]'),
        (node) => node.textContent
      )
    ).toEqual(['Hel', 'lo world']);
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 40_000 }} isAnimating>
          Hello world again
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-markdown="token"]')).toBe(first);
    expect(first?.getAttribute('style')).toBe('animation-duration: 10000ms;');
    const last = container.querySelector('[data-markdown="token"]:last-child');
    expect(last?.textContent).toBe(' again');
    expect(last?.getAttribute('style')).toBe('animation-duration: 40000ms;');
  });
  test('resuming a paused stream animates only newly appended content', async () => {
    const container = mountDOM();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Markdown animated isAnimating>
          Hello
        </Markdown>
      );
      await Promise.resolve();
    });
    await act(async () => {
      root?.render(<Markdown animated>Hello</Markdown>);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    await act(async () => {
      root?.render(
        <Markdown animated isAnimating>
          Hello
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    await act(async () => {
      root?.render(
        <Markdown animated isAnimating>
          Hello world
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(
      Array.from(
        container.querySelectorAll('[data-animated="true"]'),
        (node) => node.textContent
      )
    ).toEqual([' world']);
  });
  test('settles delivered chunks into plain text without another stream update', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const render = async (source: string): Promise<void> => {
      await act(async () => {
        root?.render(
          <Markdown animated={{ duration: 20 }} isAnimating>
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
    };
    await render('Hello brave new world');
    expect(container.querySelectorAll('[data-markdown="token"]')).toHaveLength(
      1
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe(
      'Hello brave new world'
    );
    await render('Hello brave new world again');
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' again'
    );
    expect(container.querySelectorAll('[data-markdown="token"]')).toHaveLength(
      1
    );
    expect(container.querySelector('p')?.textContent).toBe(
      'Hello brave new world again'
    );
  });
  test('repeated deliveries retain only the currently fading chunk', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let source = '';
    for (let delivery = 0; delivery < 4; delivery++) {
      source += 'A delivery containing many words. '.repeat(30);
      await act(async () => {
        root?.render(
          <Markdown animated={{ duration: 20 }} isAnimating>
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
      expect(
        container.querySelectorAll('[data-markdown="token"]')
      ).toHaveLength(1);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();
      expect(container.querySelector('p')?.textContent).toBe(source.trimEnd());
    }
  });
  test('replacing streamed text discards prior chunks without animating old content', async () => {
    const container = mountDOM();
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          The first response
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-markdown="token"]')).not.toBeNull();
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          A replacement
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('p')?.textContent).toBe('A replacement');
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          A replacement grows
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' grows'
    );
  });
  test('zero-duration streams avoid animation spans', async () => {
    const container = mountDOM();
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 0 }} isAnimating>
          Hello world
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
  });
  test('reduced-motion streams avoid animation spans', async () => {
    const container = mountDOM();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => true,
      }),
    });
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Markdown animated isAnimating>
          Hello world again
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('Hello world again');
  });
  for (const completion of ['expiry', 'pause', 'disable'] as const) {
    test(`preserves selected text during ${completion} until selection is released`, async () => {
      const container = mountDOM();
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <Markdown animated={{ duration: 20 }} isAnimating>
            Hello world
          </Markdown>
        );
        await Promise.resolve();
      });
      const token = container.querySelector('[data-markdown="token"]')!;
      const range = document.createRange();
      range.setStart(token.firstChild!, 0);
      range.setEnd(token.firstChild!, 5);
      const selection = window.getSelection()!;
      selection.addRange(range);
      await act(async () => {
        if (completion !== 'expiry') {
          root?.render(
            <Markdown
              animated={completion === 'disable' ? false : { duration: 20 }}
              isAnimating={completion !== 'pause'}
            >
              Hello world
            </Markdown>
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
      });
      expect(container.querySelector('[data-markdown="token"]')).toBe(token);
      expect(selection.toString()).toBe('Hello');
      expect(token.hasAttribute('data-animated')).toBe(false);
      await act(async () => {
        selection.removeAllRanges();
        document.dispatchEvent(new window.Event('selectionchange'));
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();
      expect(container.querySelector('p')?.textContent).toBe('Hello world');
    });
  }
  test('resuming a selected paused chunk does not restart its animation', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const render = async (
      active: boolean,
      source = 'Hello world'
    ): Promise<void> => {
      await act(async () => {
        root?.render(
          <Markdown animated={{ duration: 10_000 }} isAnimating={active}>
            {source}
          </Markdown>
        );
        await Promise.resolve();
      });
    };
    await render(true);
    const token = container.querySelector('[data-markdown="token"]')!;
    const range = document.createRange();
    range.setStart(token.firstChild!, 0);
    range.setEnd(token.firstChild!, 5);
    window.getSelection()!.addRange(range);
    await render(false);
    await render(true);
    expect(container.querySelector('[data-markdown="token"]')).toBe(token);
    expect(token.hasAttribute('data-animated')).toBe(false);
    expect(window.getSelection()!.toString()).toBe('Hello');
    await render(true, 'Hello world again');
    expect(token.hasAttribute('data-animated')).toBe(false);
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' again'
    );
  });
  test('expires each chunk using the duration captured when it arrived', async () => {
    const container = mountDOM();
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          Hello
        </Markdown>
      );
      await Promise.resolve();
    });
    const first = container.querySelector('[data-markdown="token"]')!;
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 20 }} isAnimating>
          Hello world
        </Markdown>
      );
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(first.getAttribute('data-animated')).toBe('true');
    expect(
      Array.from(
        container.querySelectorAll('[data-animated="true"]'),
        (node) => node.textContent
      )
    ).toEqual(['Hello']);
    expect(first.getAttribute('style')).toBe('animation-duration: 10000ms;');
    expect(container.querySelector('p')?.textContent).toBe('Hello world');
  });
  test('does not merge an expired chunk into a selected settled prefix', async () => {
    const container = mountDOM();
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 20 }} isAnimating>
          Hello world
        </Markdown>
      );
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    const prefix = document
      .createTreeWalker(
        container.querySelector('p')!,
        window.NodeFilter.SHOW_TEXT
      )
      .nextNode()!;
    const range = document.createRange();
    range.setStart(prefix, 0);
    range.setEnd(prefix, 5);
    const selection = window.getSelection()!;
    selection.addRange(range);
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 20 }} isAnimating>
          Hello world again
        </Markdown>
      );
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(selection.toString()).toBe('Hello');
    expect(selection.anchorNode).toBe(prefix);
    expect(selection.anchorOffset).toBe(0);
    expect(selection.focusOffset).toBe(5);
    expect(container.querySelector('p')?.textContent).toBe('Hello world again');
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    await act(async () => {
      selection.removeAllRanges();
      document.dispatchEvent(new window.Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
  });
  test('a selection outside the streamed text does not prevent settling', async () => {
    const container = mountDOM();
    const outside = document.createTextNode('Elsewhere');
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    window.getSelection()!.addRange(range);
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Markdown animated={{ duration: 20 }} isAnimating>
          Hello world
        </Markdown>
      );
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    expect(window.getSelection()!.toString()).toBe('Elsewhere');
  });
  test('animates code tokens without replacing earlier spans', async () => {
    const container = mountDOM();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          {'```text\nHel'}
        </Markdown>
      );
      await Promise.resolve();
    });
    const first = container.querySelector('pre [data-markdown="token"]');
    await act(async () => {
      root?.render(
        <Markdown animated={{ duration: 10_000 }} isAnimating>
          {'```text\nHello'}
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelector('pre [data-markdown="token"]')).toBe(first);
    expect(first?.textContent).toBe('Hel');
    expect(container.querySelector('pre')?.textContent).toContain('Hello');
    expect(
      container.querySelectorAll('pre [data-animated="true"]')
    ).toHaveLength(2);
  });
});
type ComponentPropsForParagraph = { children?: ReactNode } & ExtraProps;

describe('incremental streaming', () => {
  test('random chunk boundaries and replacements preserve full-parse output', () => {
    let seed = 17;
    const random = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    const pieces = [
      'word',
      '\n',
      '\n\n',
      '    ',
      '> ',
      '- ',
      '```',
      '[x]: /url',
      '[^x]: note',
      '**',
      '<div>',
      '</div>',
      '\r',
      '\t',
      '🥳',
      '\uFEFF',
    ];
    for (let trial = 0; trial < 100; trial++) {
      const session = createMarkdownSession();
      let input = 'Prefix\n\n';
      for (let chunk = 0; chunk < 30; chunk++) {
        input =
          (random(20) === 0 ? input.slice(0, random(input.length)) : input) +
          pieces[random(pieces.length)];
        expect(
          session.render(input, { incomplete: true }),
          JSON.stringify(input)
        ).toEqual(renderToElements(input, { incomplete: true }));
      }
    }
  });
  test('isolates mounted code sessions and disposes them through Strict Mode and plugin changes', async () => {
    const plugin = createHighlightsPlugin({
      themes: { light: pierreLight, dark: pierreDark },
      defaultColor: 'light-dark()',
    });
    const disposed: number[] = [];
    let created = 0;
    const wrapped = {
      ...plugin,
      createSession() {
        const session = plugin.createSession!();
        const id = created++;
        return {
          highlight: session.highlight,
          dispose() {
            disposed.push(id);
            session.dispose();
          },
        };
      },
    };
    const container = mountDOM();
    root = createRoot(container);
    const render = async (
      code: string,
      activePlugin = wrapped
    ): Promise<void> => {
      await act(async () => {
        root?.render(
          <StrictMode>
            <Markdown plugins={{ code: activePlugin }}>{code}</Markdown>
          </StrictMode>
        );
        await Promise.resolve();
      });
    };
    await render('```ts\nconst one = 1;\n```\n\n```css\n.a { color: red; }');
    await render(
      '```ts\nconst one = 1;\n```\n\n```css\n.a { color: red; }\n.b {}'
    );
    expect(container.textContent).toContain('const one = 1;');
    expect(container.textContent).toContain('.b {}');
    const activeBeforeReplacement = created;
    await render('```ts\nlet two = 2;\n```', { ...wrapped });
    expect(disposed.length).toBeGreaterThan(0);
    expect(created).toBeGreaterThan(activeBeforeReplacement);
    await act(async () => {
      root?.unmount();
      await Promise.resolve();
    });
    root = undefined;
    // Strict Mode may create discarded render instances, but every committed
    // session receives cleanup and remains safe to restart after effect replay.
    expect(disposed.length).toBeGreaterThanOrEqual(3);
  });
  test('matches a fresh parse at every prefix, including retroactive syntax', () => {
    const fixtures = [
      '# Hello\n\nParagraph **bold** and `code`.\n\nNext 🥳 é 中\n\n',
      'Header\n---\n\n| A | B |\n|---|---|\n|a|b|\n\nTail',
      '- first\n\n- second\n\n  nested\n\nTail\n\n',
      '> quote\n>\n> ```ts\n> /* comment\n> ends */\n> ```\n\nTail',
      'Text [later][id].\n\nMore.\n\n[id]: /target "title"\n',
      'Note[^x]\n\nOther\n\n[^x]: footnote\n\n    continued\n',
      '<div>\nraw\n\n</div>\n\nAfter\n\n',
      '# *unfinished\n\n**new\n\n[link](unfinished',
      'First\r\n\r\nSecond\r\rTail\n\n\uFEFFthird',
      '\uFEFFfirst\n\n    code\n\n    more\n\nend',
    ];
    for (const incomplete of [false, true]) {
      for (const source of fixtures) {
        const session = createMarkdownSession();
        for (let end = 0; end <= source.length; end++) {
          const input = source.slice(0, end);
          expect(session.render(input, { incomplete })).toEqual(
            renderToElements(input, { incomplete })
          );
        }
        expect(session.render('replacement', { incomplete })).toEqual(
          renderToElements('replacement', { incomplete })
        );
      }
    }
  });
  test('reuses completed blocks, isolates sessions, and resets on options or edits', () => {
    const session = createMarkdownSession();
    session.render('First\n\nSecond');
    const before = session.render('First\n\nSecond!');
    const after = session.render('First\n\nSecond!!');
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    createMarkdownSession().render('unrelated'.repeat(10000));
    expect(session.render('First\n\nSecond!!')).toBe(after);
    const input = 'Changed\n\n*unfinished';
    expect(session.render(input, { incomplete: true })).toEqual(
      renderToElements(input, { incomplete: true })
    );
    expect(session.render(input, { incomplete: false })).toEqual(
      renderToElements(input)
    );
  });
  test('live code highlighting matches fresh tokens and reuses earlier lines', () => {
    const plugin = createHighlightsPlugin({ theme: pierreLight });
    const session = plugin.createSession!();
    const simplify = (result: ReturnType<typeof plugin.highlight>) =>
      result?.tokens.map((line) =>
        line.map(({ content, color, bgColor, htmlStyle }) => ({
          content,
          color,
          bgColor,
          htmlStyle,
        }))
      );
    for (const [language, source] of [
      [
        'ts',
        'const x = `hello\n${name}`;\n/* comment\nend */\nconst emoji = "🥳";\r\nnext()',
      ],
      ['tsx', '<div title="hi">\n{items.map(x => <span>{x}</span>)}\n</div>'],
      ['css', '.foo {\n color: red;\n /* comment */\n}'],
    ]) {
      for (let end = 0; end <= source.length; end++) {
        const args = {
          code: source.slice(0, end),
          language,
          isIncomplete: true,
        };
        expect(simplify(session.highlight(args))).toEqual(
          simplify(plugin.highlight(args))
        );
      }
    }
    session.highlight({
      code: 'const x = 1;\nconst y = 2',
      language: 'ts',
      isIncomplete: true,
    });
    const before = session.highlight({
      code: 'const x = 1;\nconst y = 23',
      language: 'ts',
      isIncomplete: true,
    });
    const after = session.highlight({
      code: 'const x = 1;\nconst y = 234',
      language: 'ts',
      isIncomplete: true,
    });
    expect(after?.tokens[0]).toBe(before?.tokens[0]);
    session.dispose();
    const args = { code: 'let x = 1;', language: 'ts', isIncomplete: false };
    expect(simplify(session.highlight(args))).toEqual(
      simplify(plugin.highlight(args))
    );
    expect(
      session.highlight({ ...args, language: 'unknown-language' })
    ).toBeNull();
    session.dispose();
  });
});
