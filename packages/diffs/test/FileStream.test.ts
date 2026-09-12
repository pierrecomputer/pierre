import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  FileStream,
  type FileStreamRecallToken,
} from '../src/components/FileStream';
import type { ThemedToken } from '../src/types';
import { installDom, waitFor } from './domHarness';

async function waitUntil(predicate: () => boolean): Promise<void> {
  await waitFor(predicate);
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

  async function create() {
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
