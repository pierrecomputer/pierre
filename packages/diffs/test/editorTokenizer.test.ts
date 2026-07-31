import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type IGrammar, INITIAL, type StateStack } from 'shiki/textmate';

import {
  TextDocument,
  type TextDocumentChange,
} from '../src/editor/textDocument';
import { EditorTokenizer } from '../src/editor/tokenizer';
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

function getThemeStyle(colors: Record<string, string>): string {
  let style = '';
  const tokenizer = new EditorTokenizer({
    highlighter: createTestHighlighter({
      getTheme: () => ({ colors }),
    }),
    textDocument: new TextDocument('test.txt', 'line 0', 'text'),
    codeOptions: { theme: 'test-theme', themeType: 'dark' },
    setStyle: (nextStyle) => {
      style = nextStyle;
    },
    onDeferTokenize: () => {},
  });
  tokenizer.cleanUp();
  return style;
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

  test('derives the active-line background mix and border treatment', () => {
    const borderOnlyStyle = getThemeStyle({
      'editor.lineHighlightBorder': '#303030',
    });
    expect(borderOnlyStyle).toContain(
      '--diffs-editor-line-highlight-border: #303030;'
    );
    expect(borderOnlyStyle).toContain(
      '--diffs-editor-active-line-source-mix: 100%;'
    );

    const backgroundOnlyStyle = getThemeStyle({
      'editor.lineHighlightBackground': '#2b3036',
    });
    expect(backgroundOnlyStyle).toContain(
      '--diffs-editor-line-highlight-border: transparent;'
    );
    expect(backgroundOnlyStyle).toContain(
      '--diffs-editor-active-line-source-mix: 85%;'
    );

    const combinedStyle = getThemeStyle({
      'editor.lineHighlightBackground': '#3b4252',
      'editor.lineHighlightBorder': '#434c5e',
    });
    expect(combinedStyle).toContain(
      '--diffs-editor-line-highlight-border: #434c5e;'
    );
    expect(combinedStyle).toContain(
      '--diffs-editor-active-line-source-mix: 85%;'
    );

    const translucentStyle = getThemeStyle({
      'editor.lineHighlightBackground': '#19283c8c',
    });
    expect(translucentStyle).toContain(
      '--diffs-editor-line-highlight-border: transparent;'
    );
    expect(translucentStyle).toContain(
      '--diffs-editor-active-line-source-mix: 85%;'
    );

    const transparentStyle = getThemeStyle({
      'editor.lineHighlightBackground': '#00000000',
    });
    expect(transparentStyle).toContain(
      '--diffs-editor-line-highlight-border: color-mix(in lab, var(--diffs-bg) 70%, var(--diffs-fg));'
    );
    expect(transparentStyle).toContain(
      '--diffs-editor-active-line-source-mix: 100%;'
    );

    const missingStyle = getThemeStyle({});
    expect(missingStyle).toContain(
      '--diffs-editor-line-highlight-border: color-mix(in lab, var(--diffs-bg) 70%, var(--diffs-fg));'
    );
    expect(missingStyle).toContain(
      '--diffs-editor-active-line-source-mix: 100%;'
    );
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
          endCharacter: 0,
          endLine: 19,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
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

  test('picks up a grammar the highlighter loads after tokenizer construction', () => {
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
    let languageLoaded = false;
    const textDocument = new TextDocument(
      'test.ts',
      'const x = 1\n',
      'typescript'
    );
    const tokenizer = new EditorTokenizer({
      highlighter: createTestHighlighter({
        getLoadedLanguages: () => (languageLoaded ? ['typescript'] : []),
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
      endCharacter: 0,
      endLine: 0,
      endedAtDocumentEnd: false,
      previousLineCount: textDocument.lineCount,
      lineCount: textDocument.lineCount,
      lineDelta: 0,
      changes: [],
      changedLineRanges: [[0, 0]],
    };

    expect(() => tokenizer.tokenize(change)).toThrow(
      'Grammar for language "typescript" not loaded'
    );

    languageLoaded = true;

    expect(() => tokenizer.tokenize(change)).not.toThrow();
  });

  test('does not cache bracket ignored ranges before grammar loads', () => {
    const stringTokenMetadata = 2 << 8;
    let languageLoaded = false;
    let tokenizeLineCount = 0;
    const grammar = {
      tokenizeLine2(lineText: string, ruleStack: StateStack) {
        tokenizeLineCount++;
        return {
          tokens: new Uint32Array([0, stringTokenMetadata]),
          ruleStack,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const textDocument = new TextDocument('test.ts', "'abc['", 'typescript');
    const tokenizer = new EditorTokenizer({
      highlighter: createTestHighlighter({
        getLoadedLanguages: () => (languageLoaded ? ['typescript'] : []),
        getLanguage: () => grammar,
      }),
      textDocument,
      codeOptions: { theme: 'test-theme', themeType: 'dark' },
      setStyle: noopSetStyle,
      onDeferTokenize: () => {},
    });

    expect(tokenizer.getStringCommentRegexpRangesInLine(0)).toBe(null);
    expect(tokenizeLineCount).toBe(0);

    languageLoaded = true;

    expect(tokenizer.getStringCommentRegexpRangesInLine(0)).toEqual([[0, 6]]);
    expect(tokenizeLineCount).toBe(1);
  });

  test('does not record string/comment/regex ranges when bracket matching is disabled', () => {
    const stringTokenMetadata = 2 << 8;
    const grammar = {
      tokenizeLine2(lineText: string, ruleStack: StateStack) {
        return {
          tokens: new Uint32Array([0, stringTokenMetadata]),
          ruleStack,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const createTokenizer = (matchBrackets: boolean) => {
      const textDocument = new TextDocument('test.ts', "'abc['", 'typescript');
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        matchBrackets,
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });
      tokenizer.tokenize({
        startLine: 0,
        startCharacter: 0,
        endCharacter: 0,
        endLine: 0,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
        changedLineRanges: [[0, 0]],
      });
      return tokenizer;
    };

    expect(createTokenizer(true).getStringCommentRegexpRangesInLine(0)).toEqual(
      [[0, 6]]
    );
    expect(createTokenizer(false).getStringCommentRegexpRangesInLine(0)).toBe(
      null
    );
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
          endCharacter: 0,
          endLine: 999,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 1,
          changes: [],
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
        endCharacter: 0,
        endLine: 109,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
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

  test('seeds the viewport from the propagated state when an offscreen delete reaches it', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    globalThis.addEventListener =
      (() => {}) as typeof globalThis.addEventListener;
    globalThis.removeEventListener =
      (() => {}) as typeof globalThis.removeEventListener;
    globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;

    try {
      // Model a `/* ... */` block comment: the grammar state is either inside or
      // outside the comment, and each line is colored by the state it is
      // tokenized in (foreground index 1 = comment, 0 = code). The document opens
      // a comment on line 0 and never closes it, so every later line is inside.
      const insideComment = {
        equals: (other: StateStack) => other === insideComment,
      } as unknown as StateStack;
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          const inside = ruleStack === insideComment;
          const stillInside = inside
            ? !lineText.includes('*/')
            : lineText.includes('/*');
          return {
            tokens: new Uint32Array([0, inside ? 1 << 15 : 0]),
            ruleStack: stillInside ? insideComment : INITIAL,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        Array.from({ length: 150 }, (_, i) =>
          i === 0 ? '/*' : `mid ${i}`
        ).join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
          setTheme: () => ({ colorMap: ['#code', '#comment'] }),
        }),
        textDocument,
        codeOptions: { theme: 'test-theme', themeType: 'dark' },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });

      // Build the cached state stack across the whole document so every line
      // starts out correctly colored as comment.
      tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endCharacter: 0,
          endLine: textDocument.lineCount - 1,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
          changedLineRanges: [[0, textDocument.lineCount - 1]],
        },
        { startingLine: 0, totalLines: 150, bufferBefore: 0, bufferAfter: 0 }
      );

      // Scroll the viewport to line 100, then delete the single line directly
      // above it. The deleted range reaches the viewport's first line, so the
      // offscreen flush rebuilds the cached state right up to it.
      const renderRange = {
        startingLine: 100,
        totalLines: 10,
        bufferBefore: 0,
        bufferAfter: 0,
      };
      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 99, character: 0 },
            end: { line: 100, character: 0 },
          },
          newText: '',
        },
      ])!;
      const dirtyLines = tokenizer.tokenize(change, renderRange);

      expect(change.lineDelta).toBeLessThan(0);
      // The viewport is still inside the never-closed comment, so its first line
      // must be colored as comment — not re-tokenized from the INITIAL state.
      expect(dirtyLines.get(100)?.[0]?.[1]).toBe('#comment');
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
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
          endCharacter: 0,
          endLine: 19,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
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

  test('settles background tokenization after newline insertions reconverge', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    const originalPerformanceNow = performance.now;
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
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => 0,
    });

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
        Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'),
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
          endCharacter: 0,
          endLine: textDocument.lineCount - 1,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
          changedLineRanges: [[0, textDocument.lineCount - 1]],
        },
        {
          startingLine: 0,
          totalLines: textDocument.lineCount,
          bufferBefore: 0,
          bufferAfter: 0,
        }
      );
      tokenizeLineCount = 0;
      postedMessages.length = 0;

      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 0, character: 'line 0'.length },
            end: { line: 0, character: 'line 0'.length },
          },
          newText: '\ninserted line',
        },
      ])!;
      tokenizer.tokenize(change, {
        startingLine: 0,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      const activeJobMessage = postedMessages.at(-1);
      tokenizeLineCount = 0;

      expect(activeJobMessage).toBeDefined();
      messageListener?.({ data: activeJobMessage } as MessageEvent);

      expect(tokenizeLineCount).toBe(1);
      expect(messageListener).toBeUndefined();
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: originalPerformanceNow,
      });
    }
  });

  test('does not seed foreground tokenization from shifted convergence states', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    globalThis.addEventListener =
      (() => {}) as typeof globalThis.addEventListener;
    globalThis.removeEventListener =
      (() => {}) as typeof globalThis.removeEventListener;
    globalThis.postMessage = (() => {}) as typeof globalThis.postMessage;

    try {
      const insideComment = {
        equals: (other: StateStack) => other === insideComment,
      } as unknown as StateStack;
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          const inside = ruleStack === insideComment;
          const stillInside = inside
            ? !lineText.includes('*/')
            : lineText.includes('/*');
          return {
            tokens: new Uint32Array([0, inside ? 1 << 15 : 0]),
            ruleStack: stillInside ? insideComment : INITIAL,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument(
        'test.ts',
        Array.from({ length: 150 }, (_, i) => `line ${i}`).join('\n'),
        'typescript'
      );
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
          setTheme: () => ({ colorMap: ['#code', '#comment'] }),
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
          endCharacter: 0,
          endLine: textDocument.lineCount - 1,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
          changedLineRanges: [[0, textDocument.lineCount - 1]],
        },
        { startingLine: 0, totalLines: 150, bufferBefore: 0, bufferAfter: 0 }
      );

      const insertComment = textDocument.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '/*\n',
        },
      ])!;
      tokenizer.tokenize(insertComment, {
        startingLine: 0,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      const lowerLineText = textDocument.getLineText(100);
      const changeLowerLine = textDocument.applyEdits([
        {
          range: {
            start: { line: 100, character: 0 },
            end: { line: 100, character: lowerLineText.length },
          },
          newText: 'changed inside comment',
        },
      ])!;
      const dirtyLines = tokenizer.tokenize(changeLowerLine, {
        startingLine: 100,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      expect(dirtyLines.get(100)?.[0]?.[1]).toBe('#comment');
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
          endCharacter: 0,
          endLine: 0,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
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

  test('isolates matching background job ids between tokenizer instances', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    const messageListeners = new Set<EventListener>();
    const postedMessages: unknown[] = [];
    const tokenizers: EditorTokenizer[] = [];

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.add(listener);
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.delete(listener);
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    try {
      const tokenizeLineCounts = [0, 0];
      for (let index = 0; index < tokenizeLineCounts.length; index++) {
        const grammar = {
          tokenizeLine2(lineText: string, ruleStack: StateStack) {
            tokenizeLineCounts[index]++;
            return {
              tokens: new Uint32Array([0, 0]),
              ruleStack,
              stoppedEarly: false,
              lineText,
            };
          },
        } as unknown as IGrammar;
        const textDocument = new TextDocument(
          `test-${index}.ts`,
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
        tokenizers.push(tokenizer);
        tokenizer.tokenize(
          {
            startLine: 0,
            startCharacter: 0,
            endCharacter: 0,
            endLine: 0,
            endedAtDocumentEnd: false,
            previousLineCount: textDocument.lineCount,
            lineCount: textDocument.lineCount,
            lineDelta: 0,
            changes: [],
            changedLineRanges: [[0, 0]],
          },
          {
            startingLine: 0,
            totalLines: 1,
            bufferBefore: 0,
            bufferAfter: 0,
          }
        );
      }

      expect(postedMessages).toHaveLength(2);
      expect((postedMessages[0] as { jobId: number }).jobId).toBe(
        (postedMessages[1] as { jobId: number }).jobId
      );
      tokenizeLineCounts.fill(0);

      const event = { data: postedMessages[0] } as MessageEvent;
      for (const listener of [...messageListeners]) {
        listener(event);
      }

      expect(tokenizeLineCounts[0]).toBeGreaterThan(0);
      expect(tokenizeLineCounts[1]).toBe(0);
    } finally {
      tokenizers.forEach((tokenizer) => tokenizer.cleanUp());
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
  });

  test('queues state prebuilds and resumes them after foreground work', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    const originalSetTimeout = globalThis.setTimeout;
    const originalPerformanceNow = performance.now;
    const messageListeners = new Set<EventListener>();
    const postedMessages: unknown[] = [];
    let tokenizeLineCount = 0;

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.add(listener);
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.delete(listener);
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;
    globalThis.setTimeout = ((callback: () => void) => {
      callback();
      return 0;
    }) as unknown as typeof globalThis.setTimeout;
    let now = 0;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => (now += 2),
    });

    const states = new Map<string, StateStack>();
    const grammar = {
      tokenizeLine2(lineText: string) {
        let nextState = states.get(lineText);
        if (nextState === undefined) {
          nextState = {
            equals(other: StateStack | null) {
              return other === nextState;
            },
          } as unknown as StateStack;
          states.set(lineText, nextState);
        }
        tokenizeLineCount++;
        return {
          tokens: new Uint32Array([0, 0]),
          ruleStack: nextState,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const textDocument = new TextDocument(
      'test.ts',
      Array.from({ length: 100 }, (_, line) => `line ${line}`).join('\n'),
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

    try {
      tokenizer.prebuildStateStack({
        startingLine: 1,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      tokenizer.prebuildStateStack({
        startingLine: 3,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });

      expect(tokenizeLineCount).toBe(0);
      expect(messageListeners.size).toBe(1);

      let messageIndex = 0;
      while (messageIndex < postedMessages.length) {
        const event = { data: postedMessages[messageIndex++] } as MessageEvent;
        for (const listener of [...messageListeners]) {
          listener(event);
        }
      }

      expect(messageIndex).toBe(4);
      expect(tokenizeLineCount).toBe(4);
      expect(messageListeners.size).toBe(0);

      tokenizer.getStringCommentRegexpRangesInLine(3);
      expect(tokenizeLineCount).toBe(4);

      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 6 },
          },
          newText: 'LINE 0',
        },
      ])!;
      tokenizeLineCount = 0;
      postedMessages.length = 0;
      tokenizer.tokenize(change, {
        startingLine: 0,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      expect(postedMessages).toHaveLength(1);

      tokenizer.prebuildStateStack({
        startingLine: 99,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      expect(postedMessages).toHaveLength(1);

      messageIndex = 0;
      while (messageIndex < postedMessages.length) {
        const event = { data: postedMessages[messageIndex++] } as MessageEvent;
        for (const listener of [...messageListeners]) {
          listener(event);
        }
      }

      expect(tokenizeLineCount).toBeGreaterThan(2);
      expect(messageListeners.size).toBe(0);

      const completedTokenizeLineCount = tokenizeLineCount;
      tokenizer.getStringCommentRegexpRangesInLine(99);
      expect(tokenizeLineCount).toBe(completedTokenizeLineCount);
    } finally {
      tokenizer.cleanUp();
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
      globalThis.setTimeout = originalSetTimeout;
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: originalPerformanceNow,
      });
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
        endCharacter: 0,
        endLine: 0,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
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
        endCharacter: 0,
        endLine: 0,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
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
        endCharacter: 0,
        endLine: 0,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
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
          endCharacter: 0,
          endLine: 0,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
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
        endCharacter: 0,
        endLine: 799,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 1,
        changes: [],
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

  test('maps mixed line-count changes and completes an EOF insertion', () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    const originalPostMessage = globalThis.postMessage;
    const messageListeners = new Set<EventListener>();
    const postedMessages: unknown[] = [];
    const states = new Map<string, StateStack>();
    let tokenizeLineCount = 0;

    globalThis.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.add(listener);
      }
    }) as typeof globalThis.addEventListener;
    globalThis.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (type === 'message' && typeof listener === 'function') {
        messageListeners.delete(listener);
      }
    }) as typeof globalThis.removeEventListener;
    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;

    const grammar = {
      tokenizeLine2(lineText: string) {
        let nextState = states.get(lineText);
        if (nextState === undefined) {
          nextState = {
            equals(other: StateStack | null) {
              return other === nextState;
            },
          } as unknown as StateStack;
          states.set(lineText, nextState);
        }
        tokenizeLineCount++;
        return {
          tokens: new Uint32Array([0, 0]),
          ruleStack: nextState,
          stoppedEarly: false,
          lineText,
        };
      },
    } as unknown as IGrammar;
    const textDocument = new TextDocument(
      'test.ts',
      Array.from({ length: 12 }, (_, index) => `line ${index}`).join('\n'),
      'typescript'
    );
    const tokenizer = new EditorTokenizer({
      highlighter: createTestHighlighter({
        getLanguage: () => grammar,
      }),
      textDocument,
      codeOptions: { theme: 'test-theme', themeType: 'dark' },
      matchBrackets: false,
      setStyle: noopSetStyle,
      onDeferTokenize: () => {},
    });

    try {
      tokenizer.tokenize(
        {
          startLine: 0,
          startCharacter: 0,
          endCharacter: 0,
          endLine: textDocument.lineCount - 1,
          endedAtDocumentEnd: false,
          previousLineCount: textDocument.lineCount,
          lineCount: textDocument.lineCount,
          lineDelta: 0,
          changes: [],
          changedLineRanges: [[0, textDocument.lineCount - 1]],
        },
        {
          startingLine: 0,
          totalLines: textDocument.lineCount,
          bufferBefore: 0,
          bufferAfter: 0,
        }
      );

      const change = textDocument.applyEdits([
        {
          range: {
            start: { line: 1, character: 6 },
            end: { line: 1, character: 6 },
          },
          newText: '\na',
        },
        {
          range: {
            start: { line: 6, character: 6 },
            end: { line: 7, character: 0 },
          },
          newText: '',
        },
      ])!;
      expect(change.lineDelta).toBe(0);
      expect(change.changedLineChanges).toEqual([
        [1, 2, 1, 6, 6, false],
        [7, 7, -1, 6, 0, false],
      ]);

      tokenizeLineCount = 0;
      postedMessages.length = 0;
      const dirtyLines = tokenizer.tokenize(change, {
        startingLine: 1,
        totalLines: 2,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      expect([...dirtyLines.keys()]).toEqual([1, 2]);
      expect(tokenizeLineCount).toBe(2);

      tokenizeLineCount = 0;
      let messageIndex = 0;
      while (messageIndex < postedMessages.length) {
        const event = { data: postedMessages[messageIndex++] } as MessageEvent;
        for (const listener of [...messageListeners]) {
          listener(event);
        }
      }

      // State reconverges on the first unchanged line after the deletion, so
      // the untouched document tail is not tokenized.
      expect(tokenizeLineCount).toBe(6);
      expect(messageListeners.size).toBe(0);

      const lineCount = textDocument.lineCount;
      tokenizer.tokenize(
        {
          startLine: 9,
          startCharacter: 0,
          endCharacter: 0,
          endLine: lineCount - 1,
          endedAtDocumentEnd: false,
          previousLineCount: lineCount,
          lineCount,
          lineDelta: 0,
          changes: [],
          changedLineRanges: [[9, lineCount - 1]],
        },
        {
          startingLine: 9,
          totalLines: lineCount - 9,
          bufferBefore: 0,
          bufferAfter: 0,
        }
      );

      const eofChange = textDocument.applyEdits([
        {
          range: {
            start: { line: lineCount - 1, character: 7 },
            end: { line: lineCount - 1, character: 7 },
          },
          newText: '\ntail',
        },
      ])!;
      expect(eofChange.changedLineChanges).toEqual([[11, 12, 1, 7, 7, true]]);

      tokenizeLineCount = 0;
      postedMessages.length = 0;
      tokenizer.tokenize(eofChange, {
        startingLine: 11,
        totalLines: 1,
        bufferBefore: 0,
        bufferAfter: 0,
      });
      expect(tokenizeLineCount).toBe(1);

      tokenizeLineCount = 0;
      messageIndex = 0;
      while (messageIndex < postedMessages.length) {
        const event = { data: postedMessages[messageIndex++] } as MessageEvent;
        for (const listener of [...messageListeners]) {
          listener(event);
        }
      }
      expect(tokenizeLineCount).toBe(1);
      expect(messageListeners.size).toBe(0);
    } finally {
      tokenizer.cleanUp();
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
      globalThis.postMessage = originalPostMessage;
    }
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

  // Apps can force one scheme via page CSS/classes or advertise support for
  // both. syncTheme must only use the OS preference in the latter case.
  test('syncTheme resolves forced and preferred system themes', () => {
    const originalMatchMedia = globalThis.window.matchMedia;
    const originalGetComputedStyle = Reflect.get(
      globalThis,
      'getComputedStyle'
    );
    const originalDocument = Reflect.get(globalThis, 'document');
    const originalMutationObserver = Reflect.get(
      globalThis,
      'MutationObserver'
    );
    let colorScheme = 'dark';
    let prefersDark = false;

    globalThis.window.matchMedia = (() =>
      ({
        addEventListener: () => {},
        addListener: () => {},
        dispatchEvent: () => false,
        // OS prefers light, but the host document forces dark.
        get matches() {
          return prefersDark;
        },
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        removeEventListener: () => {},
        removeListener: () => {},
      }) as MediaQueryList) as typeof window.matchMedia;
    Reflect.set(globalThis, 'document', {
      body: {},
      documentElement: {},
    });
    Reflect.set(
      globalThis,
      'getComputedStyle',
      (() =>
        ({
          colorScheme,
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );
    Reflect.set(
      globalThis,
      'MutationObserver',
      class {
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      }
    );

    try {
      const grammar = {
        tokenizeLine2(lineText: string, ruleStack: StateStack) {
          return {
            tokens: new Uint32Array([0, 1 << 15]),
            ruleStack,
            stoppedEarly: false,
            lineText,
          };
        },
      } as unknown as IGrammar;
      const textDocument = new TextDocument('test.ts', 'line 0', 'typescript');
      const dualThemes = { light: 'light-theme', dark: 'dark-theme' };
      const tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
          setTheme: (theme: string) => ({
            colorMap: ['', theme === 'dark-theme' ? '#dark' : '#light'],
          }),
        }),
        textDocument,
        codeOptions: {
          theme: dualThemes,
          themeType: 'system',
        },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
      });

      expect(tokenizer.themeType).toBe('dark');

      // A later render sync must not flip back to the OS light preference.
      tokenizer.syncTheme({ theme: dualThemes, themeType: 'system' });
      expect(tokenizer.themeType).toBe('dark');

      // A dual declaration advertises support rather than forcing light.
      // Let the dark OS preference choose the active token color.
      colorScheme = 'light dark';
      prefersDark = true;
      tokenizer.syncTheme({ theme: dualThemes, themeType: 'system' });
      const dirtyLines = tokenizer.tokenize({
        startLine: 0,
        startCharacter: 0,
        endCharacter: 0,
        endLine: 0,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
        changedLineRanges: [[0, 0]],
      });
      expect(tokenizer.themeType).toBe('dark');
      expect(dirtyLines.get(0)?.[0]?.[1]).toBe('#dark');

      tokenizer.cleanUp();
    } finally {
      globalThis.window.matchMedia = originalMatchMedia;
      if (originalGetComputedStyle === undefined) {
        Reflect.deleteProperty(globalThis, 'getComputedStyle');
      } else {
        Reflect.set(globalThis, 'getComputedStyle', originalGetComputedStyle);
      }
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Reflect.set(globalThis, 'document', originalDocument);
      }
      if (originalMutationObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'MutationObserver');
      } else {
        Reflect.set(globalThis, 'MutationObserver', originalMutationObserver);
      }
    }
  });

  test('ignores system-theme mutations until the resolved theme changes', () => {
    const originalPostMessage = globalThis.postMessage;
    const originalGetComputedStyle = Reflect.get(
      globalThis,
      'getComputedStyle'
    );
    const originalDocument = Reflect.get(globalThis, 'document');
    const originalMutationObserver = Reflect.get(
      globalThis,
      'MutationObserver'
    );
    const postedMessages: unknown[] = [];
    let colorScheme: 'light' | 'dark' = 'dark';
    let observerCallback: MutationCallback | undefined;
    let themeChangeCount = 0;
    let tokenizer: EditorTokenizer | undefined;
    const documentStub = {
      body: {},
      documentElement: {},
    };

    globalThis.postMessage = ((message: unknown) => {
      postedMessages.push(message);
    }) as typeof globalThis.postMessage;
    Reflect.set(globalThis, 'document', documentStub);
    Reflect.set(
      globalThis,
      'getComputedStyle',
      (() =>
        ({
          colorScheme,
        }) as CSSStyleDeclaration) as typeof getComputedStyle
    );
    Reflect.set(
      globalThis,
      'MutationObserver',
      class {
        constructor(callback: MutationCallback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      }
    );

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
        ['line 0', 'line 1'].join('\n'),
        'typescript'
      );
      tokenizer = new EditorTokenizer({
        highlighter: createTestHighlighter({
          getLanguage: () => grammar,
        }),
        textDocument,
        codeOptions: {
          theme: { light: 'light-theme', dark: 'dark-theme' },
          themeType: 'system',
        },
        setStyle: noopSetStyle,
        onDeferTokenize: () => {},
        onThemeChange: () => {
          themeChangeCount++;
        },
      });

      const observer = {} as MutationObserver;
      observerCallback?.(
        [
          {
            attributeName: 'class',
            target: documentStub.documentElement,
            type: 'attributes',
          } as unknown as MutationRecord,
        ],
        observer
      );
      observerCallback?.(
        [
          {
            attributeName: 'data-layout',
            target: documentStub.body,
            type: 'attributes',
          } as unknown as MutationRecord,
        ],
        observer
      );

      expect(tokenizer.themeType).toBe('dark');
      expect(themeChangeCount).toBe(0);
      expect(postedMessages).toHaveLength(0);

      colorScheme = 'light';
      observerCallback?.(
        [
          {
            attributeName: 'data-theme',
            target: documentStub.body,
            type: 'attributes',
          } as unknown as MutationRecord,
        ],
        observer
      );

      expect(tokenizer.themeType).toBe('light');
      expect(themeChangeCount).toBe(1);
      expect(postedMessages).toHaveLength(1);
    } finally {
      tokenizer?.cleanUp();
      globalThis.postMessage = originalPostMessage;
      if (originalGetComputedStyle === undefined) {
        Reflect.deleteProperty(globalThis, 'getComputedStyle');
      } else {
        Reflect.set(globalThis, 'getComputedStyle', originalGetComputedStyle);
      }
      if (originalDocument === undefined) {
        Reflect.deleteProperty(globalThis, 'document');
      } else {
        Reflect.set(globalThis, 'document', originalDocument);
      }
      if (originalMutationObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'MutationObserver');
      } else {
        Reflect.set(globalThis, 'MutationObserver', originalMutationObserver);
      }
    }
  });

  // Dual-theme SSR (`themes: {dark,light}`) leaves the shared highlighter on the
  // last theme it applied (usually light). The tokenizer caches a single-theme
  // colorMap from construction; without re-activating that theme before an edit,
  // grammar color indices are looked up in the wrong map — property names resolve
  // to a near-foreground gray while types/comments (stable across maps) still
  // look correct. Switching files recreates the tokenizer and hides the bug.
  test('re-activates its theme before tokenize so dual-theme SSR cannot desync colorMap', async () => {
    const { disposeHighlighter, getSharedHighlighter } =
      await import('../src/highlighter/shared_highlighter');
    const { DEFAULT_THEMES } = await import('../src/constants');
    const { renderFileWithHighlighter } =
      await import('../src/utils/renderFileWithHighlighter');

    const code = `export interface ButtonProps {
  variant?: 'primary';
  isLoading?: boolean; //
}
`;
    const highlighter = await getSharedHighlighter({
      themes: [DEFAULT_THEMES.dark, DEFAULT_THEMES.light],
      langs: ['tsx'],
    });
    const textDocument = new TextDocument('Button.tsx', code, 'tsx');
    const tokenizer = new EditorTokenizer({
      highlighter,
      textDocument,
      codeOptions: { theme: DEFAULT_THEMES, themeType: 'dark' },
      setStyle: noopSetStyle,
      onDeferTokenize: () => {},
    });

    try {
      // Same dual-theme pass File/Diff renderers run on first load — leaves the
      // shared highlighter on the light theme while the tokenizer still holds the
      // dark colorMap captured at construction.
      renderFileWithHighlighter(
        { name: 'Button.tsx', contents: code, lang: 'tsx' },
        highlighter,
        {
          theme: DEFAULT_THEMES,
          useTokenTransformer: true,
          tokenizeMaxLineLength: 1000,
        }
      );

      const dirtyLines = tokenizer.tokenize({
        startLine: 2,
        startCharacter: 20,
        endCharacter: 20,
        endLine: 2,
        endedAtDocumentEnd: false,
        previousLineCount: textDocument.lineCount,
        lineCount: textDocument.lineCount,
        lineDelta: 0,
        changes: [],
        changedLineRanges: [[2, 2]],
      });

      const isLoading = dirtyLines
        .get(2)
        ?.find((token) => token[2].includes('isLoading'));
      expect(isLoading?.[1]).toBe('#FFA359');
    } finally {
      tokenizer.cleanUp();
      await disposeHighlighter();
    }
  });
});
