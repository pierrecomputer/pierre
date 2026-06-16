import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { IGrammar, StateStack } from 'shiki/textmate';

import {
  TextDocument,
  type TextDocumentChange,
} from '../src/editor/textDocument';
import { EditorTokenizer } from '../src/editor/tokenzier';
import type { DiffsHighlighter, HighlightedToken } from '../src/types';

const noopSetStyle = () => {};

function createTestHighlighter(
  overrides: Record<string, unknown> = {}
): DiffsHighlighter {
  return {
    getLoadedLanguages: () => ['typescript'],
    getTheme: () => ({ colors: {} }),
    setTheme: () => ({ colorMap: [''] }),
    ...overrides,
  } as unknown as DiffsHighlighter;
}

describe('EditorTokenizer', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window'
  );
  const originalMatchMedia = globalThis.window?.matchMedia;

  beforeAll(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: globalThis,
      writable: true,
    });
    globalThis.window.matchMedia = (() =>
      ({
        addEventListener: () => {},
        addListener: () => {},
        dispatchEvent: () => false,
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        removeEventListener: () => {},
        removeListener: () => {},
      }) as MediaQueryList) as typeof window.matchMedia;
  });

  afterAll(() => {
    if (originalWindowDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
      globalThis.window.matchMedia = originalMatchMedia;
    }
  });

  test('tokenizes plain text without loading a Shiki grammar', () => {
    const originalPostMessage = globalThis.postMessage;
    const postedMessages: unknown[] = [];
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    try {
      const getLanguage = () => {
        throw new Error('getLanguage should not be called for plain text');
      };
      const loadLanguage = () => {
        throw new Error('loadLanguage should not be called for plain text');
      };
      const textDocument = new TextDocument(
        'Untitled-1',
        Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
        'text'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage,
          loadLanguage,
          getLoadedLanguages: () => [],
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });
      const renderRange = {
        startingLine: 0,
        totalLines: 5,
        bufferBefore: 0,
        bufferAfter: 0,
      };

      const dirtyLines = tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endLine: 19,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changedLineRanges: [[0, 19]],
        },
        renderRange
      );

      expect([...dirtyLines.keys()]).toEqual([0, 1, 2, 3, 4]);
      expect(dirtyLines.get(0)?.[0]).toEqual([0, '', 'line 0']);
      expect(postedMessages).toHaveLength(0);
    } finally {
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('limits foreground tokenization to the render range after prepending lines', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalPostMessage = globalThis.postMessage;
    const postedMessages: unknown[] = [];

    globalThis.addEventListener =
      (() => {}) as typeof globalThis.addEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    try {
      let tokenizeLineCount = 0;
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          tokenizeLineCount++;
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        Array.from({ length: 1_000 }, (_, i) => `line ${i}`).join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });
      const renderRange = {
        startingLine: 900,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      };

      tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endLine: 999,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 1,
          changedLineRanges: [[0, 999]],
        },
        renderRange
      );
      tokenizeLineCount = 0;
      postedMessages.length = 0;

      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText:
            Array.from({ length: 100 }, (_, i) => `new ${i}`).join('\n') + '\n',
        },
      ])!;
      const dirtyLines = tokenizer.tokenize(change, renderRange);

      expect(tokenizeLineCount).toBe(10);
      expect([...dirtyLines.keys()]).toEqual([
        900, 901, 902, 903, 904, 905, 906, 907, 908, 909,
      ]);
      expect(postedMessages).toHaveLength(1);
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('flushes offscreen line 0 when select-all delete shrinks the document', () => {
    const grammar = {
      tokenizeLine2(lineText: string, ruleStack: StateStack) {
        return {
          tokens: new Uint32Array([0, 0]),
          ruleStack,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const textDocument = new TextDocument(
      'test.ts',
      Array.from({ length: 110 }, (_, i) => `line ${i}`).join('\n'),
      'typescript'
    );
    const offscreenUpdates: Map<number, Array<HighlightedToken>>[] = [];
    const tokenizer = new EditorTokenizer({
      highlighter: createTestHighlighter({
        getLanguage: () => grammar,
      }),
      textDocument,
      codeOptions: { theme: 'test-theme', themeType: 'dark' },
      setStyle: noopSetStyle,
      onDeferTokenize: (lines) => {
        offscreenUpdates.push(lines);
      },
    });
    const renderRange = {
      startingLine: 100,
      totalLines: 10,
      bufferBefore: 0,
      bufferAfter: 0,
    };

    tokenizer.tokenize(
      {
        startLine: 0,
        startCharacter: 0,
        endLine: 109,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changedLineRanges: [[0, 109]],
      },
      renderRange
    );
    offscreenUpdates.length = 0;

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 109, character: `line 109`.length },
        },
        newText: '',
      },
    ])!;
    const dirtyLines = tokenizer.tokenize(change, renderRange);

    expect(change.lineDelta).toBeLessThan(0);
    expect(dirtyLines.size).toBe(0);
    expect(offscreenUpdates.at(-1)?.has(0)).toBe(true);
    expect(offscreenUpdates.at(-1)?.get(0)?.[0]?.[2]).toBe('');
  });

  test('tokenizes inserted lines past the render range in the background', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    let messageListener: ((event: MessageEvent) => void) | undefined;
    const postedMessages: unknown[] = [];

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListener = listener as (event: MessageEvent) => void;
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && listener === messageListener) {
        messageListener = undefined;
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    try {
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
        'typescript'
      );
      const deferredUpdates: Map<number, Array<HighlightedToken>>[] = [];
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: (lines) => {
          deferredUpdates.push(lines);
        },
      });
      const renderRange = {
        startingLine: 0,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      };

      tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endLine: 19,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changedLineRanges: [[0, 19]],
        },
        renderRange
      );
      postedMessages.length = 0;

      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 8, character: 'line 8'.length },
            end: { line: 8, character: 'line 8'.length },
          },
          newText: '\ninserted 9\ninserted 10\ninserted 11',
        },
      ])!;
      const dirtyLines = tokenizer.tokenize(change, renderRange);
      const activeJobMessage = postedMessages.at(-1);

      expect([...dirtyLines.keys()]).toEqual([8, 9]);
      expect(activeJobMessage).toBeDefined();

      messageListener?.({ data: activeJobMessage } as MessageEvent);
      expect(deferredUpdates.at(-1)?.get(10)?.[0]?.[2]).toBe('inserted 10');
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('registers global message listener only while background tokenization runs', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    const addedListeners: EventListenerOrEventListenerObject[] = [];
    const removedListeners: EventListenerOrEventListenerObject[] = [];

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message') {
        addedListeners.push(listener);
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message') {
        removedListeners.push(listener);
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;

    try {
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        ['line 0', 'line 1', 'line 2'].join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });
      expect(addedListeners).toHaveLength(0);

      tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changedLineRanges: [[0, 0]],
        },
        { startingLine: 0, totalLines: 1, bufferBefore: 0, bufferAfter: 0 }
      );
      expect(addedListeners).toHaveLength(1);
      expect(removedListeners).toHaveLength(0);

      tokenizer.stopBackgroundTokenize();
      expect(removedListeners).toHaveLength(1);
      expect(removedListeners[0]).toBe(addedListeners[0]);

      tokenizer.cleanUp();
      expect(removedListeners).toHaveLength(1);
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('settles zero-line edits before the viewport without rebuilding to the viewport', () => {
    let tokenizeLineCount = 0;
    const grammar = {
      tokenizeLine2(lineText: string, ruleStack: StateStack) {
        tokenizeLineCount++;
        return {
          tokens: new Uint32Array([0, 0]),
          ruleStack,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const textDocument = new TextDocument(
      'test.ts',
      Array.from({ length: 110 }, (_, i) => `line ${i}`).join('\n'),
      'typescript'
    );
    const offscreenUpdates: Map<number, Array<HighlightedToken>>[] = [];
    const tokenizer = new EditorTokenizer({
      highlighter: createTestHighlighter({
        getLanguage: () => grammar,
      }),
      textDocument,
      codeOptions: { theme: 'test-theme', themeType: 'dark' },
      setStyle: noopSetStyle,
      onDeferTokenize: (lines) => {
        offscreenUpdates.push(lines);
      },
    });

    tokenizer.tokenize(
      {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changedLineRanges: [[0, 0]],
      },
      { startingLine: 100, totalLines: 10, bufferBefore: 0, bufferAfter: 0 }
    );
    tokenizeLineCount = 0;

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 'line 0'.length },
        },
        newText: 'LINE 0',
      },
    ])!;
    const dirtyLines = tokenizer.tokenize(change, {
      startingLine: 100,
      totalLines: 10,
      bufferBefore: 0,
      bufferAfter: 0,
    });

    expect(tokenizeLineCount).toBe(1);
    expect(dirtyLines.size).toBe(0);
    expect(offscreenUpdates.at(-1)?.get(0)?.[0]?.[2]).toBe('LINE 0');
  });

  test('ignores queued background messages from stopped jobs', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    let messageListener: ((event: MessageEvent) => void) | undefined;
    const postedMessages: unknown[] = [];

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListener = listener as (event: MessageEvent) => void;
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && listener === messageListener) {
        messageListener = undefined;
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    try {
      let tokenizeLineCount = 0;
      const state = { equals: () => false } as unknown as StateStack;
      const grammar = {
        tokenizeLine2() {
          tokenizeLineCount++;
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack: state,
            stoppedEarly: false,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        ['line 0', 'line 1', 'line 2'].join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });
      const change: TextDocumentChange = {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changedLineRanges: [[0, 0]],
      };
      const renderRange = {
        startingLine: 0,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      };

      tokenizer.tokenize(change, renderRange);
      const stoppedJobMessage = postedMessages.at(-1);
      tokenizer.stopBackgroundTokenize();
      tokenizer.tokenize(change, renderRange);
      const activeJobMessage = postedMessages.at(-1);
      tokenizeLineCount = 0;

      messageListener?.({ data: stoppedJobMessage } as MessageEvent);
      expect(tokenizeLineCount).toBe(0);

      messageListener?.({ data: activeJobMessage } as MessageEvent);
      expect(tokenizeLineCount).toBeGreaterThan(0);
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('pauses and resumes background tokenization', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    let messageListener: ((event: MessageEvent) => void) | undefined;
    const postedMessages: unknown[] = [];

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListener = listener as (event: MessageEvent) => void;
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && listener === messageListener) {
        messageListener = undefined;
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    try {
      let tokenizeLineCount = 0;
      const state = { equals: () => false } as unknown as StateStack;
      const grammar = {
        tokenizeLine2() {
          tokenizeLineCount++;
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack: state,
            stoppedEarly: false,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        ['line 0', 'line 1', 'line 2'].join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });
      const change: TextDocumentChange = {
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changedLineRanges: [[0, 0]],
      };
      const renderRange = {
        startingLine: 0,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      };

      tokenizer.tokenize(change, renderRange);
      const queuedMessage = postedMessages.at(-1);
      tokenizeLineCount = 0;

      tokenizer.pauseBackgroundTokenize();
      messageListener?.({ data: queuedMessage } as MessageEvent);
      expect(tokenizeLineCount).toBe(0);

      tokenizer.resumeBackgroundTokenize();
      const resumedMessage = postedMessages.at(-1);
      messageListener?.({ data: resumedMessage } as MessageEvent);
      expect(tokenizeLineCount).toBeGreaterThan(0);
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('ignores non-tokenize and non-object message payloads safely', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    let messageListener: ((event: MessageEvent) => void) | undefined;

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListener = listener as (event: MessageEvent) => void;
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && listener === messageListener) {
        messageListener = undefined;
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;

    try {
      let tokenizeLineCount = 0;
      const state = { equals: () => false } as unknown as StateStack;
      const grammar = {
        tokenizeLine2() {
          tokenizeLineCount++;
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack: state,
            stoppedEarly: false,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        ['line 0', 'line 1', 'line 2'].join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });

      tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changedLineRanges: [[0, 0]],
        },
        { startingLine: 0, totalLines: 1, bufferBefore: 0, bufferAfter: 0 }
      );

      tokenizeLineCount = 0;
      messageListener?.({ data: 'not-an-object' } as MessageEvent);
      messageListener?.({ data: { type: 'other', jobId: 1 } } as MessageEvent);
      messageListener?.({
        data: { type: 'tokenize', jobId: '1' },
      } as MessageEvent);
      expect(tokenizeLineCount).toBe(0);
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('jumps between exact changed ranges for multi-cursor edits', () => {
    let tokenizeLineCount = 0;
    const grammar = {
      tokenizeLine2(lineText: string, ruleStack: StateStack) {
        tokenizeLineCount++;
        return {
          tokens: new Uint32Array([0, 0]),
          ruleStack,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const textDocument = new TextDocument(
      'test.ts',
      Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n'),
      'typescript'
    );
    const tokenizer = new EditorTokenizer({
      highlighter: createTestHighlighter({
        getLanguage: () => grammar,
      }),
      textDocument,
      codeOptions: { theme: 'test-theme', themeType: 'dark' },
      setStyle: noopSetStyle,
      onDeferTokenize: () => {},
    });

    tokenizer.tokenize(
      {
        startLine: 0,
        startCharacter: 0,
        endLine: 799,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 1,
        changedLineRanges: [[0, 799]],
      },
      { startingLine: 0, totalLines: 800, bufferBefore: 0, bufferAfter: 0 }
    );
    tokenizeLineCount = 0;

    const change = textDocument.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 'line 0'.length },
        },
        newText: 'LINE 0',
      },
      {
        range: {
          start: { line: 750, character: 0 },
          end: { line: 750, character: 'line 750'.length },
        },
        newText: 'LINE 750',
      },
    ])!;
    const dirtyLines = tokenizer.tokenize(change, {
      startingLine: 0,
      totalLines: 800,
      bufferBefore: 0,
      bufferAfter: 0,
    });

    expect(change.changedLineRanges).toEqual([
      [0, 0],
      [750, 750],
    ]);
    expect(tokenizeLineCount).toBe(2);
    expect([...dirtyLines.keys()]).toEqual([0, 750]);
  });

  test('pins a dual-theme surface to an explicit themeType instead of following the page', () => {
    const originalMatchMedia = globalThis.window.matchMedia;
    let mediaListenerCount = 0;
    globalThis.window.matchMedia = (() =>
      ({
        addEventListener: () => {
          mediaListenerCount++;
        },
        addListener: () => {},
        dispatchEvent: () => false,
        // The page prefers dark, but the surface is forced light: the tokenizer
        // must ignore this and emit the light theme so its tokens match the
        // forced-light SSR markup.
        matches: true,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        removeEventListener: () => {},
        removeListener: () => {},
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          return {
            tokens: new Uint32Array([0, 0]),
            ruleStack,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument('test.ts', 'line 0', 'typescript');
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: {
          theme: { light: 'light-theme', dark: 'dark-theme' },
          themeType: 'light',
        },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });

      expect(tokenizer.themeType).toBe('light');
      expect(mediaListenerCount).toBe(0);
    } finally {
      globalThis.window.matchMedia = originalMatchMedia;
    }
  });
});
