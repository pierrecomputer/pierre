import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  FileStream,
  type FileStreamRecallToken,
} from '../src/components/FileStream';
import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  highlighters,
} from '../src/highlighter';
import type { BaseCodeOptions, ThemedToken } from '../src/types';
import { installDom, waitFor } from './domHarness';

// Cold Shiki grammars can compile before the first render frame.
async function waitUntil(predicate: () => boolean): Promise<void> {
  await waitFor(predicate, { timeout: 5000 });
  expect(predicate()).toBe(true);
}

describe('FileStream', () => {
  let dom: ReturnType<typeof installDom>;
  const instances: FileStream[] = [];
  beforeEach(() => {
    dom = installDom();
  });
  afterEach(() => {
    for (const instance of instances) instance.cleanUp();
    instances.length = 0;
    dom.cleanup();
  });

  async function create(
    preferredHighlighter?: BaseCodeOptions['preferredHighlighter']
  ) {
    let controller!: ReadableStreamDefaultController<string>;
    let closed = false;
    const writes: (ThemedToken | FileStreamRecallToken)[] = [];
    const source = new ReadableStream<string>({
      start(value) {
        controller = value;
      },
    });
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const instance = new FileStream({
      lang: 'typescript',
      preferredHighlighter,
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      onStreamWrite: (token) => writes.push(token),
      onStreamClose: () => {
        closed = true;
      },
    });
    instances.push(instance);
    await instance.setup(source, wrapper);
    const content = () =>
      wrapper.firstElementChild?.shadowRoot?.querySelector('[data-content]');
    return {
      instance,
      wrapper,
      controller,
      writes,
      content,
      get closed() {
        return closed;
      },
    };
  }

  test('shows unfinished chunks and replaces them with native highlighted tokens', async () => {
    const stream = await create();
    stream.controller.enqueue('const message = "hel');
    await waitUntil(
      () => stream.content()?.textContent === 'const message = "hel'
    );
    stream.controller.enqueue('lo";\n');
    stream.controller.close();
    await waitUntil(
      () =>
        stream.closed &&
        stream.content()?.textContent === 'const message = "hello";\n'
    );
    expect(stream.writes.some((token) => 'recall' in token)).toBe(true);
    const stringToken = stream.writes.find(
      (token): token is ThemedToken =>
        'content' in token && token.content === '"hello"'
    );
    expect(stringToken?.htmlStyle?.['--diffs-token-dark']).toBeDefined();
    expect(stringToken?.htmlStyle?.['--diffs-token-light']).toBeDefined();
    expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(2);
  });

  test('keeps multiline lexer state and stream offsets across chunks', async () => {
    const stream = await create();
    stream.controller.enqueue('/* first\n');
    await waitUntil(() => stream.content()?.textContent === '/* first\n');
    stream.controller.enqueue('second');
    await waitUntil(() => stream.content()?.textContent === '/* first\nsecond');
    stream.controller.enqueue(' */\nconst x = 1;');
    stream.controller.close();
    await waitUntil(
      () =>
        stream.closed &&
        stream.content()?.textContent === '/* first\nsecond */\nconst x = 1;'
    );
    const comment = stream.writes.find(
      (token): token is ThemedToken =>
        'content' in token && token.content === 'second */'
    );
    expect(comment?.type).toBe(1);
    expect(comment?.offset).toBe(9);
    expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(3);
  });

  for (const preferredHighlighter of ['shiki-wasm', 'shiki-js'] as const) {
    test(`streams multiline code through ${preferredHighlighter}`, async () => {
      const stream = await create(preferredHighlighter);
      stream.controller.enqueue('/* first\n');
      await waitUntil(() => stream.content()?.textContent === '/* first\n');
      stream.controller.enqueue('second */\nconst x = 1;');
      stream.controller.close();
      await waitUntil(
        () =>
          stream.closed &&
          stream.content()?.textContent === '/* first\nsecond */\nconst x = 1;'
      );
      const comment = stream.writes.find(
        (token): token is ThemedToken =>
          'content' in token && token.content === 'second */'
      );
      expect(comment?.offset).toBe(9);
      expect(comment?.htmlStyle?.['--diffs-token-dark']).toBeDefined();
      expect(comment?.htmlStyle?.['--diffs-token-light']).toBeDefined();
      expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(3);
    });
  }

  test('queued setup resolves the latest backend, theme, and language', async () => {
    await disposeHighlighter();
    const originalLoader = highlighters.highlights;
    let release!: () => void;
    let signalStarted!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    highlighters.highlights = async () => {
      signalStarted();
      await paused;
      return originalLoader();
    };
    const firstWrapper = document.createElement('div');
    const latestWrapper = document.createElement('div');
    document.body.append(firstWrapper, latestWrapper);
    const instance = new FileStream({
      lang: 'typescript',
      theme: 'pierre-dark',
    });
    instances.push(instance);
    let closed = false;
    const writes: (ThemedToken | FileStreamRecallToken)[] = [];
    const firstSetup = instance.setup(
      new ReadableStream<string>(),
      firstWrapper
    );
    try {
      await started;
      instance.options = {
        preferredHighlighter: 'shiki-js',
        theme: 'github-light',
        lang: 'rust',
        onStreamWrite: (token) => writes.push(token),
        onStreamClose: () => {
          closed = true;
        },
      };
      await instance.setup(
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue('fn main() { let answer = 42; }');
            controller.close();
          },
        }),
        latestWrapper
      );
      release();
      await firstSetup;
      await waitUntil(
        () =>
          closed &&
          latestWrapper.firstElementChild?.shadowRoot?.querySelector(
            '[data-content]'
          )?.textContent === 'fn main() { let answer = 42; }'
      );
      expect(firstWrapper.childElementCount).toBe(0);
      expect(
        getHighlighterIfLoaded({
          preferredHighlighter: 'shiki-js',
          theme: 'github-light',
          langs: ['rust'],
        })?.name
      ).toBe('shiki-js');
      expect(
        writes.some((token) => 'content' in token && token.color != null)
      ).toBe(true);
    } finally {
      release();
      highlighters.highlights = originalLoader;
      await firstSetup.catch(() => {});
    }
  });

  test('setup can retry after a failed backend load', async () => {
    await disposeHighlighter();
    const originalLoader = highlighters.highlights;
    const instance = new FileStream();
    instances.push(instance);
    const wrapper = document.createElement('div');
    const loadError = new Error('Load failed');
    highlighters.highlights = () => Promise.reject(loadError);
    try {
      const error = await instance
        .setup(new ReadableStream<string>(), wrapper)
        .catch((error: unknown) => error);
      expect(error).toBe(loadError);
    } finally {
      highlighters.highlights = originalLoader;
    }
    await instance.setup(new ReadableStream<string>(), wrapper);
    expect(wrapper.childElementCount).toBe(1);
  });

  for (const restart of [false, true]) {
    test(`cleanup cancels pending setup${restart ? ' without canceling its replacement' : ''}`, async () => {
      await disposeHighlighter();
      const originalLoader = highlighters.highlights;
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      highlighters.highlights = async () => {
        await paused;
        return originalLoader();
      };
      const instance = new FileStream();
      instances.push(instance);
      const firstWrapper = document.createElement('div');
      const latestWrapper = document.createElement('div');
      const firstSetup = instance.setup(
        new ReadableStream<string>(),
        firstWrapper
      );
      let latestSetup: Promise<void> | undefined;
      try {
        instance.cleanUp();
        if (restart) {
          latestSetup = instance.setup(
            new ReadableStream<string>(),
            latestWrapper
          );
        }
        release();
        await Promise.all([firstSetup, latestSetup]);
        expect(firstWrapper.childElementCount).toBe(0);
        expect(latestWrapper.childElementCount).toBe(restart ? 1 : 0);
      } finally {
        release();
        highlighters.highlights = originalLoader;
        await Promise.all([firstSetup, latestSetup]);
      }
    });
  }

  for (const preferredHighlighter of [
    'highlights',
    'shiki-wasm',
    'shiki-js',
  ] as const) {
    test(`preserves CR-only stream rows with ${preferredHighlighter}`, async () => {
      const stream = await create(preferredHighlighter);
      stream.controller.enqueue('/* first\r');
      await waitUntil(() => stream.content()?.textContent === '/* first\r');
      stream.controller.enqueue('second */\rconst x = 1;');
      await waitUntil(
        () =>
          stream.content()?.textContent === '/* first\rsecond */\rconst x = 1;'
      );
      expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(3);
      const comment = stream.writes.find(
        (token): token is ThemedToken =>
          'content' in token && token.content === 'second */'
      );
      expect(comment?.offset).toBe(9);
      expect(comment?.htmlStyle?.['--diffs-token-dark']).toBeDefined();
      stream.controller.close();
      await waitUntil(() => stream.closed);
    });
  }

  test.each(['a\rb', 'a\rb\n', 'a\r'])(
    'closes a Highlights stream containing %j without losing text',
    async (code) => {
      const stream = await create();
      stream.controller.enqueue(code);
      stream.controller.close();
      await waitUntil(() => stream.closed);
      expect(stream.content()?.textContent).toBe(code);
      expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(
        code.split(/\r\n|\r|\n/).length
      );
    }
  );

  test('preserves CRLF boundaries and a trailing empty line', async () => {
    const stream = await create();
    stream.controller.enqueue('const x = 1;\r');
    await waitUntil(() => stream.writes.length > 0);
    stream.controller.enqueue('\nconst y = 2;\r\n');
    stream.controller.close();
    await waitUntil(
      () =>
        stream.closed &&
        stream.content()?.textContent === 'const x = 1;\r\nconst y = 2;\r\n'
    );
    expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(3);
  });

  test('an empty source renders one empty line', async () => {
    const stream = await create();
    stream.controller.close();
    await waitUntil(
      () =>
        stream.closed &&
        stream.content() !== null &&
        stream.content() !== undefined
    );
    expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(1);
    expect(stream.content()?.textContent).toBe('');
  });

  test('replacing a source clears prior output and cancels its producer', async () => {
    const stream = await create();
    stream.controller.enqueue('old content');
    await waitUntil(() => stream.content()?.textContent === 'old content');
    await stream.instance.setup(
      new ReadableStream<string>({
        start(controller) {
          controller.enqueue('const fresh = true;');
          controller.close();
        },
      }),
      stream.wrapper
    );
    await waitUntil(
      () => stream.content()?.textContent === 'const fresh = true;'
    );
    expect(stream.content()?.querySelectorAll('[data-line]')).toHaveLength(1);
    expect(() => stream.controller.enqueue('stale')).toThrow();
  });
});
