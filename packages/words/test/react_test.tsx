import pierreDark from '@pierre/highlights/themes/pierre-dark';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import { createHtmlSession, renderToHtml } from '@pierre/words';
import { afterEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { act, StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';

import { createDomRenderer } from '../html/dom';
import { createHtmlRenderer } from '../html/render';
import { createHighlightsPlugin } from '../react/highlights';
import { Markdown } from '../react/react';
import { defaultUrlTransform } from '../react/react';
import type { Components, HtmlOptions } from '../react/react';

const decoder = new TextDecoder();
const html = (
  source: string,
  props: Partial<Parameters<typeof Markdown>[0]> = {}
): string => renderToStaticMarkup(<Markdown {...props}>{source}</Markdown>);
/** Render a fresh HTML session for comparisons that must bypass cached prefixes. */
const parse = (source: string, incomplete = false): string =>
  createHtmlSession().render(source, { incomplete }).html;

/** Read visible output with the browser HTML parser only in semantic tests. */
function text(source: string, incomplete = false): string {
  const document = new JSDOM(parse(source, incomplete));
  try {
    return document.window.document.body.textContent ?? '';
  } finally {
    document.window.close();
  }
}
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

/** Compare token styling independently of existing live/static line-span serialization. */
function canonicalizeCode(fragment: DocumentFragment): void {
  for (const code of fragment.querySelectorAll('pre code')) {
    if (code.querySelector('span[style]') === null) continue;
    const walker = document.createTreeWalker(code, 4);
    let text = walker.nextNode();
    while (text !== null) {
      text.nodeValue = text.nodeValue?.replace(/\n/g, '') ?? '';
      text = walker.nextNode();
    }
    for (const span of code.querySelectorAll('span')) {
      const style = span.getAttribute('style');
      if (style !== null)
        span.setAttribute('style', style.replace(/;\s*$/, ''));
      if (span.childElementCount === 0 && span.textContent === '')
        span.remove();
    }
    code.normalize();
    for (const span of code.querySelectorAll('span')) {
      if (span.childElementCount !== 0) continue;
      let next = span.nextSibling;
      while (
        next?.nodeType === 1 &&
        (next as Element).tagName === 'SPAN' &&
        (next as Element).childElementCount === 0 &&
        span.cloneNode(false).isEqualNode(next.cloneNode(false))
      ) {
        while (next.firstChild !== null) span.append(next.firstChild);
        const sibling = next.nextSibling;
        next.parentNode!.removeChild(next);
        next = sibling;
      }
    }
    code.normalize();
  }
}

/** Compare exact text and parsed HTML, ignoring owned cursors and equivalent code spans. */
function expectFreshDom(
  container: HTMLElement,
  source: string,
  options: HtmlOptions
): void {
  const actual = document.createElement('template');
  actual.innerHTML = container.innerHTML.replace(
    /<!--markdown(?:-code)?-->/g,
    ''
  );
  const expected = document.createElement('template');
  const fresh = createHtmlRenderer(options);
  try {
    expected.innerHTML = fresh.render(source, true, true).html;
  } finally {
    fresh.dispose();
  }
  expect(actual.content.textContent, JSON.stringify(source)).toBe(
    expected.content.textContent
  );
  canonicalizeCode(actual.content);
  canonicalizeCode(expected.content);
  actual.content.normalize();
  expected.content.normalize();
  expect(
    actual.content.isEqualNode(expected.content),
    JSON.stringify(source)
  ).toBe(true);
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

describe('direct WAT HTML output', () => {
  test('owns its strings and escapes generated entities exactly once', () => {
    const output = parse(
      'é **中 &amp; &lt; &amp;lt;** ![alt &quot;x&quot;](/img)'
    );
    renderToHtml('another document'.repeat(20000));
    expect(output).toContain('中 &amp; &lt; &amp;lt;');
    expect(output).toContain('alt="alt &quot;x&quot;"');
  });
  test('streamed HTML excludes raw tags while preserving ordinary inline text', () => {
    expect(text('Hello <span onclick="bad()">world</span>')).toBe(
      'Hello world\n'
    );
    expect(parse('<img src=x onerror="bad()">').trim()).toBe('');
    expect(
      decoder.decode(renderToHtml('<img src=x onerror="bad()">'))
    ).toContain('onerror');
  });
  test('large HTML strings survive memory growth and renderer reuse', () => {
    const output = parse(
      Array.from({ length: 5000 }, (_, i) => `**row ${i}** & text\n\n`).join('')
    );
    expect(output.match(/<p>/g)).toHaveLength(5000);
    expect(
      output.endsWith('<p><strong>row 4999</strong> &amp; text</p>\n')
    ).toBe(true);
    expect(parse('# again')).toBe('<h1>again</h1>\n');
    expect(output.startsWith('<p><strong>row 0</strong>')).toBe(true);
  });
  test('tables, tasks, links, and footnotes render directly as HTML', () => {
    const output = parse(
      '- [x] Done\n\n| A | B |\n|---|---|\n|x|y|\n\nNote[^1]\n\n[^1]: Detail'
    );
    expect(output).toContain('<table>');
    expect(output).toContain('checked');
    expect(output).toContain('footnote-ref');
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
      expect(text(source, true)).toBe(text(source));
    }
  });
  test('protects nested fences and reports their completion from the block parser', () => {
    for (const source of [
      '> ```js\n> **literal',
      '- item\n\n  ```js\n  **literal',
    ]) {
      expect(text(source, true)).toBe(text(source));
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
      const first = parse(source, true);
      expect(parse(source, true)).toBe(first);
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

describe('HTML rendering and the React wrapper', () => {
  test('formats initial content once and reuses its caches for appends', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let calls = 0;
    const components: Components = {
      p: (value) => {
        calls++;
        return value;
      },
    };
    const render = async (value: string): Promise<void> => {
      await act(async () => {
        root?.render(<Markdown components={components}>{value}</Markdown>);
      });
    };
    await render('First\n\nSecond');
    expect(calls).toBe(2);
    const first = container.querySelector('p');
    await render('First\n\nSecond');
    expect(calls).toBe(2);
    await render('First\n\nSecond grows');
    expect(calls).toBe(3);
    expect(container.querySelector('p')).toBe(first);
  });
  test('hydration effects reuse the client formatting pass', async () => {
    let calls = 0;
    const components: Components = {
      a: (value) => {
        calls++;
        return value;
      },
    };
    const element = (
      <Markdown components={components}>{'See [guide](/docs).'}</Markdown>
    );
    const markup = renderToString(element);
    expect(calls).toBe(1);
    const container = mountDOM(markup);
    const anchor = container.querySelector('a');
    await act(async () => {
      root = hydrateRoot(container, element);
    });
    expect(calls).toBe(2);
    expect(container.querySelector('a')).toBe(anchor);
  });
  test('StrictMode releases initial highlighters and reuses formatting through effect replay', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let calls = 0;
    let live = 0;
    const highlight = (): string => {
      calls++;
      return 'highlighted';
    };
    const plugins = {
      code: {
        highlight,
        createSession: () => {
          live++;
          return {
            highlight,
            dispose: () => {
              live--;
            },
          };
        },
      },
    };
    const render = async (value: string): Promise<void> => {
      await act(async () => {
        root?.render(
          <StrictMode>
            <Markdown plugins={plugins} isAnimating>
              {value}
            </Markdown>
          </StrictMode>
        );
      });
    };
    await render('```text\nHello');
    expect(calls).toBe(2);
    expect(live).toBe(0);
    await render('```text\nHello world');
    expect(calls).toBe(3);
    expect(live).toBe(1);
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    expect(live).toBe(0);
  });
  test('validates URLs, omits raw source HTML, and escapes entities once', () => {
    const output = html(
      '[bad](javascript:alert(1))\n\n![bad](data:image/svg+xml,bad)\n\n<img src=x onerror="bad()">'
    );
    expect(output).not.toContain('javascript:');
    expect(output).not.toContain('data:image');
    expect(output).not.toContain('onerror');
    expect(
      html('[safe](https://example.com)', {
        urlTransform: () => 'javascript:bad()',
      })
    ).not.toContain('href=');
    expect(html('é **中 &amp; &lt; &amp;lt;**')).toContain(
      '中 &amp; &lt; &amp;lt;'
    );
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
  test('runs HTML hooks on generated markup and keeps inline code separate', () => {
    const components: Components = {
      a: (value) => value.replace('<a ', '<a class="custom" '),
      inlineCode: (value) =>
        value.replace(/^<code[^>]*>|<\/code>$/g, (tag) =>
          tag.startsWith('</') ? '</mark>' : '<mark>'
        ),
    };
    const output = html(
      '[**Hello**](/docs) and `inline`\n\n```text\nfenced\n```',
      { components }
    );
    expect(output).toContain('<a class="custom"');
    expect(output).toContain('<strong data-markdown="strong">Hello</strong>');
    expect(output).toContain('<mark>inline</mark>');
    expect(output).toContain('language-text');
    expect(output).not.toContain('<mark>fenced');
  });
  test('supports filtering, unwrapping and code controls', () => {
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
  test('highlights through HTML output and falls back for unknown languages', () => {
    const plugins = {
      code: createHighlightsPlugin({
        themes: { light: pierreLight, dark: pierreDark },
        defaultColor: 'light-dark()',
      }),
    };
    expect(html('```ts\nconst x = 1;\n```', { plugins })).toContain(
      'style="color:'
    );
    expect(html('```unknown\n<literal>\n```', { plugins })).toContain(
      '&lt;literal&gt;'
    );
  });
  test('hydrates the opaque HTML region and preserves its anchors', async () => {
    const element = (
      <Markdown>{'See [guide](/docs) and note[^1].\n\n[^1]: Detail'}</Markdown>
    );
    const container = mountDOM(renderToString(element));
    const anchor = container.querySelector('a')!;
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, element, {
        onRecoverableError: (error) => errors.push(error),
      });
      await Promise.resolve();
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('a')).toBe(anchor);
    const reference = container.querySelector('[data-footnote-ref]')!;
    expect(
      container.querySelector(
        `[id="${reference.getAttribute('href')!.slice(1)}"]`
      )
    ).not.toBeNull();
  });
  test('preserves completed DOM blocks and only formats the changing suffix', async () => {
    const container = mountDOM();
    root = createRoot(container);
    let completedCalls = 0;
    const components: Components = {
      p: (value) => {
        if (value.includes('Completed')) completedCalls++;
        return value;
      },
    };
    const render = async (value: string) => {
      await act(async () => {
        root?.render(<Markdown components={components}>{value}</Markdown>);
      });
    };
    await render('Completed\n\nPending');
    const paragraph = container.querySelector('p');
    const text = paragraph!.firstChild;
    const calls = completedCalls;
    await render('Completed\n\nPending grows');
    await render('Completed\n\nPending grows again');
    expect(completedCalls).toBe(calls);
    expect(container.querySelector('p')).toBe(paragraph);
    expect(paragraph!.firstChild).toBe(text);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('p')[1].textContent).toBe(
      'Pending grows again'
    );
  });
  test('definition fallback and replacement edits update earlier HTML correctly', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const render = async (value: string) => {
      await act(async () => {
        root?.render(<Markdown>{value}</Markdown>);
      });
    };
    await render('See [later][id].\n\nTail');
    await render('See [later][id].\n\nTail\n\n[id]: /resolved');
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/resolved'
    );
    await render('A replacement **message**');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('message');
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
  test('changes code controls when a fence closes without replacing earlier output', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const render = async (value: string, active = true) => {
      await act(async () => {
        root?.render(<Markdown isAnimating={active}>{value}</Markdown>);
      });
    };
    await render('Earlier\n\n```ts\nconst x = 1;');
    const paragraph = container.querySelector('p');
    const code = container.querySelector('code');
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(
      true
    );
    await render('Earlier\n\n```ts\nconst x = 1;\n```\n\nTail');
    expect(container.querySelector<HTMLButtonElement>('button')?.disabled).toBe(
      false
    );
    expect(container.querySelector('p')).toBe(paragraph);
    expect(container.querySelector('code')).toBe(code);
  });
  test('releases the live highlighter at completion, replacement and unmount', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const plugin = createHighlightsPlugin({ theme: pierreLight });
    let live = 0;
    const plugins = {
      code: {
        ...plugin,
        createSession() {
          const session = plugin.createSession!();
          live++;
          let disposed = false;
          return {
            highlight: session.highlight,
            dispose() {
              if (!disposed) {
                live--;
                disposed = true;
              }
              session.dispose();
            },
          };
        },
      },
    };
    const render = async (value: string) => {
      await act(async () => {
        root?.render(
          <Markdown plugins={plugins} isAnimating>
            {value}
          </Markdown>
        );
      });
    };
    await render('```ts\nconst x = 1;');
    expect(live).toBe(0);
    await render('```ts\nconst x = 12;');
    expect(live).toBe(1);
    await render('```ts\nconst x = 12;\n```\n\nTail');
    expect(live).toBe(0);
    await render('```css\n.a { color: red;');
    expect(live).toBe(1);
    await render('Replacement');
    expect(live).toBe(0);
    await render('```ts\nlet next = 2;');
    expect(live).toBe(1);
    await act(async () => {
      root?.unmount();
    });
    root = undefined;
    expect(live).toBe(0);
  });
  test('keeps React responsible only for the container, not Markdown leaves', async () => {
    const container = mountDOM();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <Markdown animated isAnimating>
          {'A **paragraph** and [link](/docs).\n\n'.repeat(100)}
        </Markdown>
      );
      await Promise.resolve();
    });
    expect(container.querySelectorAll('p')).toHaveLength(100);
    const rendererRoot = container.querySelector('[data-markdown="root"]')!;
    const key = Object.keys(rendererRoot).find((name) =>
      name.startsWith('__reactFiber$')
    )!;
    const fiber = (
      rendererRoot as unknown as Record<string, { child: unknown }>
    )[key];
    expect(fiber.child).toBeNull();
  });
});

describe('native DOM token fades', () => {
  const pause = async (milliseconds = 60): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, milliseconds));
    });
  };
  async function render(
    value: string,
    active = true,
    duration = 20,
    enabled = true
  ): Promise<HTMLElement> {
    if (root === undefined) {
      const container = mountDOM();
      root = createRoot(container);
    }
    await act(async () => {
      root?.render(
        <Markdown
          animated={enabled ? { duration } : false}
          isAnimating={active}
        >
          {value}
        </Markdown>
      );
      await Promise.resolve();
    });
    return document.getElementById('app')!;
  }
  test('only new chunks fade; settled text has no animation records in the DOM', async () => {
    const container = await render('Hello');
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      'Hello'
    );
    await pause();
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    const prefix = container.querySelector('p')!.firstChild;
    await render('Hello world');
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' world'
    );
    expect(container.querySelector('p')!.firstChild).toBe(prefix);
    await pause();
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('Hello world');
  });
  test('late definitions resolve without replaying fades on earlier content', async () => {
    const prefix =
      '```tsx\nexport function Message() { return <Markdown />; }\n```\n\n' +
      '> The best part of a good tool is what you make with it.\n\n' +
      'Keep exploring [Pierre][pierre]. Every detail counts.[^1]\n\n';
    const container = await render(prefix, false);
    const definitions =
      '[pierre]: https://diffs.com\n[^1]: Even the little ones at the bottom of the page.\n\n';
    const formatter = createHtmlRenderer();
    formatter.render(prefix, true, true);
    for (let end = 1; end <= definitions.length; end++) {
      const source = prefix + definitions.slice(0, end);
      const update = formatter.render(source, true, true);
      await render(source, true, 10_000);
      if (update.reset) {
        const earlier = Array.from(
          container.querySelectorAll('pre, blockquote, p')
        ).filter(
          (node) =>
            node.matches('pre, blockquote') ||
            node.textContent?.startsWith('Keep exploring')
        );
        expect(
          earlier.flatMap((node) =>
            Array.from(
              node.querySelectorAll('[data-markdown="token"]'),
              (token) => token.textContent
            )
          )
        ).toEqual([]);
      }
      expect(container.querySelector('blockquote')?.textContent).toContain(
        'The best part of a good tool is what you make with it.'
      );
    }
    expect(
      container.querySelector('a[href="https://diffs.com"]')?.textContent
    ).toBe('Pierre');
    expect(container.querySelector('[data-footnote-ref]')).not.toBeNull();
    await render(prefix + definitions, false);
    await render(prefix + definitions + 'New paragraph', true, 10_000);
    expect(
      container.querySelector('[data-markdown="token"]')?.textContent
    ).toBe('New paragraph');
    formatter.dispose();
  });
  test('batches fade timers and compacts each affected parent once', () => {
    const container = mountDOM();
    const renderer = createDomRenderer(container);
    const timeout = globalThis.setTimeout;
    const nodePrototype = dom!.window.Node.prototype;
    const normalize = nodePrototype.normalize;
    const scheduled: number[] = [];
    const normalized: Node[] = [];
    globalThis.setTimeout = new Proxy(timeout, {
      apply(target, receiver, args) {
        scheduled.push(Number(args[1]));
        return Reflect.apply(target, receiver, args);
      },
    });
    try {
      renderer.connect();
      renderer.update('First **bold**\n\nSecond', true, true, {
        duration: 10_000,
      });
      expect(scheduled).toHaveLength(1);
      renderer.update('First **bold**\n\nSecond grows', true, true, {
        duration: 40_000,
      });
      expect(scheduled).toHaveLength(1);
      renderer.update('First **bold**\n\nSecond grows again', true, true, {
        duration: 1000,
      });
      expect(scheduled).toHaveLength(2);
      const second = container.querySelectorAll('p')[1];
      nodePrototype.normalize = new Proxy(normalize, {
        apply(target, receiver, args) {
          normalized.push(receiver as Node);
          Reflect.apply(target, receiver, args);
        },
      });
      renderer.update('First **bold**\n\nSecond grows again', true, false);
      expect(normalized.filter((node) => node === second)).toHaveLength(1);
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    } finally {
      renderer.disconnect();
      globalThis.setTimeout = timeout;
      nodePrototype.normalize = normalize;
    }
  });
  test('keeps previous spans and captured durations while chunks arrive', async () => {
    const container = await render('Hel', true, 10_000);
    const first = container.querySelector('[data-markdown="token"]');
    await render('Hello world', true, 40_000);
    expect(container.querySelector('[data-markdown="token"]')).toBe(first);
    expect(first?.getAttribute('style')).toContain('10000ms');
    expect(
      Array.from(
        container.querySelectorAll('[data-animated="true"]'),
        (node) => node.textContent
      )
    ).toEqual(['Hel', 'lo world']);
  });
  test('keeps bold text and its existing fades mounted at streamed word boundaries', async () => {
    const source =
      'Good tools get out of your way. **Great tools make you want to keep going.**\n\n';
    const start = source.indexOf('Great') + 'Great'.length;
    const container = await render(source.slice(0, start), true, 10_000);
    const bold = container.querySelector('strong')!;
    const first = bold.querySelector('[data-markdown="token"]')!;
    expect(first.textContent).toBe('Great');
    for (let end = start + 1; end <= source.length; end++) {
      await render(source.slice(0, end), true, 10_000);
      expect(container.querySelector('strong'), source.slice(0, end)).toBe(
        bold
      );
      expect(bold.querySelector('[data-markdown="token"]')).toBe(first);
      expect(first.isConnected).toBe(true);
      expect(container.querySelector('p')?.textContent).not.toContain('**');
    }
    expect(bold.textContent).toBe('Great tools make you want to keep going.');
  });
  test('keeps link labels mounted through the incomplete destination boundary', async () => {
    const container = await render(
      'See [Hello **world** and `code`',
      true,
      10_000
    );
    const link = container.querySelector('a')!;
    const token = link.querySelector('[data-markdown="token"]')!;
    for (const suffix of [
      ']',
      '](',
      '](https:',
      '](https://example.com',
      '](https://example.com)',
    ]) {
      await render('See [Hello **world** and `code`' + suffix, true, 10_000);
      expect(container.querySelector('a')).toBe(link);
      expect(link.querySelector('[data-markdown="token"]')).toBe(token);
    }
    expect(link.getAttribute('href')).toBe('https://example.com');
  });
  for (const finish of ['expiry', 'pause', 'disable'] as const) {
    test(`removes fade wrappers after ${finish}`, async () => {
      const container = await render('Hello world');
      const token = container.querySelector('[data-markdown="token"]')!;
      if (finish !== 'expiry')
        await render(
          'Hello world',
          finish !== 'pause',
          20,
          finish !== 'disable'
        );
      await pause();
      expect(token.isConnected).toBe(false);
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();
      expect(container.querySelector('p')?.textContent).toBe('Hello world');
      expect(container.querySelector('p')?.childNodes).toHaveLength(1);
    });
  }
  test('pause and resume never replay earlier chunks', async () => {
    const container = await render('Hello', true, 10_000);
    await render('Hello', false, 10_000);
    await render('Hello', true, 10_000);
    expect(container.querySelector('[data-animated="true"]')).toBeNull();
    await render('Hello again', true, 10_000);
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' again'
    );
  });
  test('zero duration bypasses fade wrappers', async () => {
    const container = await render('Visible', true, 0);
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('Visible');
  });
  test('reduced motion stops live fades and only new text fades after it is disabled', async () => {
    const container = mountDOM();
    root = createRoot(container);
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_name: string, callback: () => void) =>
        listeners.add(callback),
      removeEventListener: (_name: string, callback: () => void) =>
        listeners.delete(callback),
    };
    window.matchMedia = () => query as unknown as MediaQueryList;
    await render('Hello', true, 10_000);
    expect(container.querySelector('[data-animated="true"]')).not.toBeNull();
    query.matches = true;
    for (const listener of listeners) listener();
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    await render('Hello visible', true, 10_000);
    expect(container.querySelector('[data-markdown="token"]')).toBeNull();
    query.matches = false;
    for (const listener of listeners) listener();
    await render('Hello visible again', true, 10_000);
    expect(container.querySelector('[data-animated="true"]')?.textContent).toBe(
      ' again'
    );
  });
  test('insertion and fade cleanup never read or listen for selection', async () => {
    const container = mountDOM();
    const getSelection = document.getSelection;
    const addEventListener = document.addEventListener;
    document.getSelection = () => {
      throw new Error('Markdown must not query the selection');
    };
    document.addEventListener = new Proxy(addEventListener, {
      apply(target, receiver, args) {
        if (args[0] === 'selectionchange')
          throw new Error('Markdown must not listen for selection changes');
        Reflect.apply(target, receiver, args);
      },
    });
    const renderer = createDomRenderer(container);
    try {
      renderer.connect();
      renderer.update('Hello', true, true, { duration: 20 });
      renderer.update('Hello world\n\nSecond', true, true, { duration: 20 });
      expect(container.querySelector('[data-animated="true"]')).not.toBeNull();
      await pause();
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();

      renderer.update('Hello world\n\nSecond chunk', true, true, true);
      expect(container.querySelector('[data-animated="true"]')).not.toBeNull();
      renderer.update('Hello world\n\nSecond chunk', true, false, true);
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();

      renderer.update('Hello world\n\nSecond chunk again', true, true, true);
      expect(container.querySelector('[data-animated="true"]')).not.toBeNull();
      renderer.update('Hello world\n\nSecond chunk again', true, true, false);
      expect(container.querySelector('[data-markdown="token"]')).toBeNull();
      expect(container.querySelectorAll('p')[1]?.textContent).toBe(
        'Second chunk again'
      );
    } finally {
      try {
        renderer.disconnect();
      } finally {
        document.getSelection = getSelection;
        document.addEventListener = addEventListener;
      }
    }
  });
  test('code text fades without remounting previous code nodes', async () => {
    const container = await render('```text\nHel', true, 10_000);
    const code = container.querySelector('code');
    const first = code?.querySelector('[data-markdown="token"]');
    await render('```text\nHello', true, 10_000);
    expect(container.querySelector('code')).toBe(code);
    expect(code?.querySelector('[data-markdown="token"]')).toBe(first);
  });
});

describe('direct HTML sessions', () => {
  for (const stage of ['completed addition', 'pending suffix']) {
    test(`retry recovers the full DOM after a hook fails in the ${stage}`, () => {
      let reject = '';
      const options = {
        controls: false,
        components: {
          p: (value: string) => {
            if (reject !== '' && value.includes(reject)) {
              reject = '';
              throw new Error('Hook failed once');
            }
            return value.replace('<p ', '<p class="hook" ');
          },
        },
      };
      const formatter = createHtmlRenderer(options);
      const initial = formatter.render('First\n\nTail', true);
      const container = mountDOM(initial.html);
      const renderer = createDomRenderer(container, options, formatter);
      try {
        renderer.update('First\n\nTail', true);
        const source = 'First\n\nTail grows\n\nNext';
        reject = stage === 'completed addition' ? 'Tail grows' : 'Next';
        expect(() => renderer.update(source, true)).toThrow('Hook failed once');
        renderer.update(source, true);
        expect(
          [...container.querySelectorAll('p.hook')].map(
            (node) => node.textContent
          )
        ).toEqual(['First', 'Tail grows', 'Next']);
        const recovered = formatter.render(source, true);
        expect(recovered.revision).toBe(initial.revision + 1);
        expect(recovered.reset).toBe(true);
        const fresh = createHtmlRenderer(options);
        try {
          expect(recovered.html).toBe(fresh.render(source, true).html);
        } finally {
          fresh.dispose();
        }
      } finally {
        renderer.disconnect();
      }
    });
  }
  test('consecutive DOM updates consume HTML additions without reading full output', () => {
    const container = mountDOM();
    const formatter = createHtmlRenderer({ controls: false });
    const originalRender = formatter.render;
    let inspect = false;
    formatter.render = (...args) => {
      const update = originalRender(...args);
      if (!inspect) return update;
      return new Proxy(update, {
        get(target, property, receiver) {
          if (property === 'html' || property === 'stable')
            throw new Error(
              'Consecutive updates must only consume HTML additions'
            );
          return Reflect.get(target, property, receiver);
        },
      });
    };
    const renderer = createDomRenderer(
      container,
      { controls: false },
      formatter
    );
    try {
      renderer.update('First\n\nTail', true);
      const first = container.querySelector('p');
      inspect = true;
      renderer.update('First\n\nTail grows\n\nNext', true);
      renderer.update('First\n\nTail grows\n\nNext', true);
      renderer.update(
        'First\n\nTail grows\n\nNext',
        true,
        true,
        false,
        'block'
      );
      renderer.update(
        'First\n\nTail grows\n\nNext',
        true,
        true,
        false,
        'circle'
      );
      expect(container.querySelector('p')).toBe(first);
      expect(
        [...container.querySelectorAll('p')].map((node) => node.textContent)
      ).toEqual(['First', 'Tail grows', 'Next']);
      expect(
        container.querySelector('[data-markdown="caret"]')?.textContent
      ).toBe('●');
    } finally {
      renderer.disconnect();
    }
  });
  test('initial markup and skipped formatter revisions recover the complete prefix', () => {
    const options = { controls: false };
    const formatter = createHtmlRenderer(options);
    const initial = formatter.render('First\n\nTail', true);
    const container = mountDOM(initial.html);
    const first = container.querySelector('p');
    const renderer = createDomRenderer(container, options, formatter);
    try {
      renderer.update('First\n\nTail', true);
      formatter.render('First\n\nTail grows\n\nSkipped', true);
      renderer.update('First\n\nTail grows\n\nSkipped grows\n\nNext', true);
      expect(container.querySelector('p')).toBe(first);
      expect(
        [...container.querySelectorAll('p')].map((node) => node.textContent)
      ).toEqual(['First', 'Tail grows', 'Skipped grows', 'Next']);
      const replaced = formatter.render('Replacement\n\nTail', true);
      renderer.update('Replacement\n\nTail', true);
      renderer.configure({
        controls: false,
        components: { p: (value) => value.replace('<p ', '<p class="hook" ') },
      });
      renderer.update('Replacement\n\nTail', true);
      expect(container.querySelectorAll('p.hook')).toHaveLength(2);
      expect(initial.html).toContain('First');
      expect(replaced.html).toContain('Replacement');
      expect(replaced.html).not.toContain('class="hook"');
    } finally {
      renderer.disconnect();
    }
  });
  test('native streaming DOM matches fresh HTML through changing Markdown structure', () => {
    const container = mountDOM();
    const renderer = createDomRenderer(container, { controls: false });
    renderer.connect();
    const fixtures = [
      '# *Hello*\n\nParagraph **bold** and [link](/docs).',
      'Title\n---\n\n| A | B |\n|---|---|\n|x|y|\n\nTail',
      '- first\n\n- second\n\n> quoted **text**',
      '```ts\nconst x = 1;\n```\n\nTail',
      'See [later][id].\n\n[id]: /resolved',
    ];
    for (const source of fixtures)
      for (let end = 0; end <= source.length; end++) {
        const value = source.slice(0, end);
        renderer.update(value, true, true);
        const expected = document.createElement('template');
        const fresh = createHtmlRenderer({ controls: false });
        expected.innerHTML = fresh.render(value, true, true).html;
        fresh.dispose();
        const actual = document.createDocumentFragment();
        for (const child of container.childNodes)
          if (child.nodeType !== 8) actual.append(child.cloneNode(true));
        actual.normalize();
        expected.content.normalize();
        expect(
          actual.isEqualNode(expected.content),
          JSON.stringify(value)
        ).toBe(true);
      }
    renderer.disconnect();
  });
  test('plain streaming does not retain one DOM text node per delivery', () => {
    const container = mountDOM();
    const renderer = createDomRenderer(container);
    renderer.connect();
    let source = 'Text';
    for (let at = 0; at < 100; at++) {
      source += ' more';
      renderer.update(source, true, true);
    }
    expect(container.querySelector('p')!.childNodes).toHaveLength(1);
    expect(container.querySelector('p')!.textContent).toBe(source);
    renderer.disconnect();
  });
  test('incremental HTML equals a fresh render at every UTF-16 prefix and after edits', () => {
    const fixtures = [
      'First\n\nSecond **bold** and 🥳.\n\nTail',
      '> quote\n>\n> - a\n> - b\n\nTail',
      '```ts\nconst x = 1;\n```\n\nTail',
      'See [later][id].\n\nTail\n\n[id]: /resolved',
      'Note[^a].\n\n[^a]: Footnote',
      'A\r\n\r\nB\n\n\uFEFFtail',
      '<div>\nraw\n\n</div>\n\nAfter',
    ];
    for (const incomplete of [false, true])
      for (const source of fixtures) {
        const session = createHtmlSession();
        for (let end = 0; end <= source.length; end++) {
          const value = source.slice(0, end);
          expect(session.render(value, { incomplete }).html).toBe(
            createHtmlSession().render(value, { incomplete }).html
          );
        }
        expect(session.render('Replacement', { incomplete }).html).toBe(
          '<p>Replacement</p>\n'
        );
      }
  });
  test('the framework-independent DOM API works without a React tree', () => {
    const container = mountDOM();
    const renderer = createDomRenderer(container, { controls: false });
    renderer.connect();
    renderer.update('One\n\nTwo', true);
    const first = container.querySelector('p');
    renderer.update('One\n\nTwo grows', true);
    expect(container.querySelector('p')).toBe(first);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    renderer.disconnect();
  });
});

describe('incremental streaming', () => {
  test('changed-line HTML reconstructs fresh highlighting and keeps older lazy strings', () => {
    const plugin = createHighlightsPlugin({ theme: pierreLight });
    const session = plugin.createSession!();
    let previous = '';
    const snapshots: {
      output: { readonly fullHtml: string };
      expected: string;
    }[] = [];
    try {
      const source =
        'const greeting = `é 🥳\n${name}`;\r\n\r\n/* comment\r\nends */\r\n';
      for (let end = 0; end <= source.length; end++) {
        const code = source.slice(0, end);
        const options = { code, language: 'ts', isIncomplete: true };
        const update = session.highlightLines!(options)!;
        const prefix = previous.split('\n').slice(0, update.firstLine);
        const reconstructed =
          update.firstLine === update.lineCount
            ? previous
            : prefix.join('\n') + (prefix.length > 0 ? '\n' : '') + update.html;
        const fresh = plugin.createSession!();
        let expected: string;
        try {
          expected = fresh.highlight(options)!;
        } finally {
          fresh.dispose();
        }
        expect(reconstructed, JSON.stringify(code)).toBe(expected);
        // Do not read this getter yet: subsequent edits must not change its captured strings.
        snapshots.push({ output: update, expected });
        previous = reconstructed;
      }
      for (const code of ['const replaced = 1;\n', 'const replaced = 12;\n']) {
        const options = { code, language: 'ts', isIncomplete: true };
        const update = session.highlightLines!(options)!;
        const fresh = plugin.createSession!();
        try {
          expect(update.fullHtml).toBe(fresh.highlight(options)!);
        } finally {
          fresh.dispose();
        }
      }
      session.dispose();
      expect(
        session.highlightLines!({
          code: 'literal',
          language: 'unknown-language',
          isIncomplete: true,
        })
      ).toBeNull();
      expect(
        session.highlightLines!({
          code: '.x { color: red; }\n',
          language: 'css',
          isIncomplete: true,
        })?.fullHtml
      ).toContain('color:');
      for (const { output, expected } of snapshots)
        expect(output.fullHtml).toBe(expected);
    } finally {
      session.dispose();
    }
  });
  test('highlighted fence DOM matches fresh HTML at partial lines, closure, and replacements', () => {
    const options = {
      controls: false,
      plugins: { code: createHighlightsPlugin({ theme: pierreLight }) },
    };
    const container = mountDOM();
    const renderer = createDomRenderer(container, options);
    try {
      const fixtures = [
        '```ts\nconst greeting = `é 🥳\n${name}`;\n\n/* comment\nends */\n```\n\nTail',
        '```ts\r\nconst value = "é";\r\n\r\nvalue++;\r\n```',
        '```ts\n\n```',
      ];
      for (const source of fixtures)
        for (let end = 0; end <= source.length; end++) {
          const value = source.slice(0, end);
          renderer.update(value, true, true);
          expectFreshDom(container, value, options);
        }
      const replacement = '```ts\nlet replacement = true;';
      renderer.update(replacement, true, true);
      expectFreshDom(container, replacement, options);
    } finally {
      renderer.disconnect();
    }
  });
  test('large live fences parse only their changed tail and keep settled token nodes', () => {
    const plugin = createHighlightsPlugin({ theme: pierreLight });
    let fullReads = 0;
    const options = {
      controls: false,
      lineNumbers: false,
      plugins: {
        code: {
          ...plugin,
          createSession() {
            const session = plugin.createSession!();
            return {
              ...session,
              highlightLines(options: Parameters<typeof session.highlight>[0]) {
                const update = session.highlightLines!(options);
                return update === null
                  ? null
                  : new Proxy(update, {
                      get(target, property, receiver) {
                        if (property === 'fullHtml') fullReads++;
                        return Reflect.get(target, property, receiver);
                      },
                    });
              },
            };
          },
        },
      },
    };
    const container = mountDOM();
    const renderer = createDomRenderer(container, options);
    let source =
      '```ts\n' +
      Array.from(
        { length: 400 },
        (_, line) => `const value${line} = ${line};\n`
      ).join('') +
      'const current = ';
    renderer.update(source, true, true);
    const code = container.querySelector('code')!;
    const settled = code.querySelector('span');
    const fullLength = container.innerHTML.length;
    const initialFullReads = fullReads;
    const prototype = window.Element.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'innerHTML')!;
    const parsed: number[] = [];
    Object.defineProperty(prototype, 'innerHTML', {
      ...descriptor,
      set(value: string) {
        if (this instanceof window.HTMLTemplateElement)
          parsed.push(value.length);
        descriptor.set!.call(this, value);
      },
    });
    try {
      for (const chunk of [
        '1',
        '2',
        ';',
        '\n',
        '\n',
        'const next = ',
        '"é"',
        ';\n',
      ]) {
        source += chunk;
        renderer.update(source, true, true);
        expect(container.querySelector('code')).toBe(code);
        expect(code.querySelector('span')).toBe(settled);
      }
      expect(Math.max(...parsed)).toBeLessThan(fullLength / 8);
      expect(parsed.reduce((total, count) => total + count, 0)).toBeLessThan(
        fullLength / 2
      );
      expect(fullReads).toBe(initialFullReads);
    } finally {
      Object.defineProperty(prototype, 'innerHTML', descriptor);
      renderer.disconnect();
    }
    expectFreshDom(container, source, options);
  });
  test('an empty changed line from a custom highlighter clears the previous code tail', () => {
    const highlight = ({ code }: { code: string }): string =>
      code.includes(' hidden') ? '' : '<span>visible</span>';
    const options = {
      controls: false,
      lineNumbers: false,
      plugins: {
        code: {
          highlight,
          createSession() {
            return {
              highlight,
              highlightLines(options: { code: string }) {
                const html = highlight(options);
                return {
                  firstLine: 0,
                  lineCount: 1,
                  lastLineOffset: 0,
                  html,
                  fullHtml: html,
                };
              },
              dispose() {},
            };
          },
        },
      },
    };
    const container = mountDOM();
    const renderer = createDomRenderer(container, options);
    try {
      renderer.update('```custom\nfirst', true, true);
      const code = container.querySelector('code');
      expect(code?.textContent).toBe('visible');
      renderer.update('```custom\nfirst hidden', true, true);
      expect(container.querySelector('code')).toBe(code);
      expect(code?.textContent).toBe('');
    } finally {
      renderer.disconnect();
    }
  });
  test('places live code checkpoints before multiline plain-text fades are inserted', () => {
    const options = {
      controls: false,
      plugins: {
        code: createHighlightsPlugin({
          theme: pierreLight,
          tokenizeMaxLineLength: 1,
        }),
      },
    };
    const container = mountDOM();
    const renderer = createDomRenderer(container, options);
    const animated = { duration: 10_000 };
    const source = 'Earlier\n\n```ts\nfirst\nsecond';
    try {
      renderer.update('Earlier', true, true, animated);
      renderer.update(source, true, true, animated);
      const code = container.querySelector('code')!;
      const firstFade = code.querySelector('[data-markdown="token"]');
      expect(code.textContent).toBe('first\nsecond\n');
      expect(firstFade).not.toBeNull();
      renderer.update(source + ' more', true, true, animated);
      expect(container.querySelector('code')).toBe(code);
      expect(code.textContent).toBe('first\nsecond more\n');
      expect(code.querySelector('[data-markdown="token"]')).toBe(firstFade);
    } finally {
      renderer.disconnect();
    }
  });
  test('fence fallbacks survive nested containers, custom hooks, filters, and skipped revisions', () => {
    const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };
    const options = { controls: false, plugins };
    const formatter = createHtmlRenderer(options);
    const container = mountDOM();
    const renderer = createDomRenderer(container, options, formatter);
    try {
      for (const source of [
        '> ```ts\n> const x = 1;\n> const y = 2;',
        '- item\n\n  ```ts\n  const x = 1;\n  const y = 2;',
        '```unknown-language\n<literal>\nmore',
      ]) {
        renderer.update(source, true, true);
        renderer.update(source + '\nnext', true, true);
        expectFreshDom(container, source + '\nnext', options);
      }
      const source = '```ts\nconst x = 1;\n';
      renderer.update(source, true, true);
      formatter.render(source + 'const skipped = 2;\n', true, true);
      const latest = source + 'const skipped = 2;\nconst final = 3;';
      renderer.update(latest, true, true);
      expectFreshDom(container, latest, options);
      for (const next of [
        {
          ...options,
          components: {
            code: (value: string) =>
              value.replace('<code', '<code data-custom="true"'),
          },
        },
        { ...options, disallowedElements: ['code'] },
      ]) {
        renderer.configure(next);
        renderer.update(source, true, true);
        renderer.update(latest, true, true);
        expectFreshDom(container, latest, next);
      }
    } finally {
      renderer.disconnect();
    }
  });
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
      const session = createHtmlSession();
      let input = 'Prefix\n\n';
      for (let chunk = 0; chunk < 30; chunk++) {
        input =
          (random(20) === 0 ? input.slice(0, random(input.length)) : input) +
          pieces[random(pieces.length)];
        expect(
          session.render(input, { incomplete: true }).html,
          JSON.stringify(input)
        ).toBe(parse(input, true));
      }
    }
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
        const session = createHtmlSession();
        for (let end = 0; end <= source.length; end++) {
          const input = source.slice(0, end);
          expect(session.render(input, { incomplete }).html).toBe(
            parse(input, incomplete)
          );
        }
        expect(session.render('replacement', { incomplete }).html).toBe(
          parse('replacement', incomplete)
        );
      }
    }
  });
  test('reuses completed blocks, isolates sessions, and resets on options or edits', () => {
    const session = createHtmlSession();
    session.render('First\n\nSecond');
    const before = session.render('First\n\nSecond!');
    const after = session.render('First\n\nSecond!!');
    expect(after.stable).toBe(before.stable);
    expect(after.pending).not.toBe(before.pending);
    createHtmlSession().render('unrelated'.repeat(10000));
    expect(session.render('First\n\nSecond!!')).toBe(after);
    const input = 'Changed\n\n*unfinished';
    expect(session.render(input, { incomplete: true }).html).toBe(
      parse(input, true)
    );
    expect(session.render(input, { incomplete: false }).html).toBe(
      parse(input)
    );
  });
  test('live HTML highlighting keeps literal code and resumes after disposal', () => {
    const plugin = createHighlightsPlugin({ theme: pierreLight });
    const session = plugin.createSession!();
    const container = mountDOM();
    const source =
      'const x = `hello\n${name}`;\n/* comment\nend */\nconst emoji = "🥳";';
    for (let end = 0; end <= source.length; end++) {
      const code = source.slice(0, end);
      container.innerHTML =
        session.highlight({ code, language: 'ts', isIncomplete: true }) ?? '';
      expect(container.textContent).toBe(code);
    }
    session.dispose();
    expect(
      session.highlight({
        code: 'let x = 1;',
        language: 'ts',
        isIncomplete: false,
      })
    ).toContain('color:');
    expect(
      session.highlight({
        code: 'unknown',
        language: 'unknown-language',
        isIncomplete: false,
      })
    ).toBeNull();
    session.dispose();
  });
});
