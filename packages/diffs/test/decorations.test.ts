import { describe, expect, test } from 'bun:test';
import type { ElementContent, Element as HASTElement } from 'hast';

import { DiffHunksRenderer, FileRenderer, parseDiffFromFile } from '../src';
import { UnresolvedFileHunksRenderer } from '../src/renderers/UnresolvedFileHunksRenderer';
import type { DiffDecorationItem, FileDecorationItem } from '../src/types';
import { mergeNormalizedLineDecorations } from '../src/utils/getLineDecorationProperties';
import {
  normalizeDiffDecorations,
  normalizeFileDecorations,
} from '../src/utils/normalizeLineDecorations';
import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { assertDefined, collectAllElements } from './testUtils';

describe('Decoration Rendering', () => {
  test('file renderer writes gutter and content decoration attrs', async () => {
    const file = {
      name: 'example.ts',
      contents: ['one', 'two', 'three'].join('\n'),
    };
    const decorations: FileDecorationItem[] = [
      { lineNumber: 1, bar: true, color: 'red' },
      { lineNumber: 1, endLineNumber: 3, bar: true, color: 'green' },
      { lineNumber: 2, endLineNumber: 4, background: true, color: 'blue' },
      { lineNumber: 2, background: '#123456', bar: true, color: 'orange' },
    ];

    const renderer = new FileRenderer();
    renderer.setDecorations(decorations);
    const result = await renderer.asyncRender(file);
    const codeAST = renderer.renderCodeAST(result) as HASTElement[];
    const [gutter, content] = codeAST;
    assertDefined(gutter, 'expected gutter column');
    assertDefined(content, 'expected content column');

    const gutterLine1 = findElementByProperty(
      gutter.children,
      'data-column-number',
      1
    );
    const gutterLine2 = findElementByProperty(
      gutter.children,
      'data-column-number',
      2
    );
    const contentLine2 = findElementByProperty(
      content.children,
      'data-line',
      2
    );
    const contentLine1 = findElementByProperty(
      content.children,
      'data-line',
      1
    );
    const contentLine3 = findElementByProperty(
      content.children,
      'data-line',
      3
    );
    const gutterLine3 = findElementByProperty(
      gutter.children,
      'data-column-number',
      3
    );

    assertDefined(gutterLine1, 'expected first gutter line');
    assertDefined(gutterLine2, 'expected second gutter line');
    assertDefined(gutterLine3, 'expected third gutter line');
    assertDefined(contentLine1, 'expected first content line');
    assertDefined(contentLine2, 'expected second content line');
    assertDefined(contentLine3, 'expected third content line');

    const gutterLine1BarStack = findElementByProperty(
      gutterLine1.children,
      'data-decoration-bar-stack',
      ''
    );
    const gutterLine2BarStack = findElementByProperty(
      gutterLine2.children,
      'data-decoration-bar-stack',
      ''
    );
    const gutterLine3BarStack = findElementByProperty(
      gutterLine3.children,
      'data-decoration-bar-stack',
      ''
    );

    assertDefined(gutterLine1BarStack, 'expected first gutter bar stack');
    assertDefined(gutterLine2BarStack, 'expected second gutter bar stack');
    assertDefined(gutterLine3BarStack, 'expected third gutter bar stack');

    expect(gutterLine1.properties['data-decoration-bar']).toBe('0,1');
    expect(
      gutterLine1BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('2');
    expect(gutterLine1BarStack.properties['data-decoration-bar-overlap']).toBe(
      ''
    );
    expect(gutterLine1BarStack.properties['data-decoration-bar-second']).toBe(
      ''
    );
    expect(
      gutterLine1BarStack.properties['data-decoration-bar-third']
    ).toBeUndefined();
    expect(gutterLine1BarStack.children).toHaveLength(0);
    expectStyleContains(gutterLine1BarStack.properties.style, [
      '--diffs-decoration-bar-width-1:6px;',
      '--diffs-decoration-bar-color-1:green;',
      '--diffs-decoration-bar-start-radius-1:4px;',
      '--diffs-decoration-bar-end-radius-1:0px;',
      '--diffs-decoration-bar-width-2:10px;',
      'color-mix(in lab, red 74%, var(--diffs-bg))',
    ]);
    expect(gutterLine1.properties['data-decoration-bar-depth']).toBe('2');
    expect(gutterLine1.properties['data-decoration-bar-start']).toBe('0,1');
    expect(gutterLine1.properties['data-decoration-bar-end']).toBe('0');
    expect(gutterLine2.properties['data-decoration-bar']).toBe('1,3');
    expect(
      gutterLine2BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('2');
    expect(gutterLine2BarStack.properties['data-decoration-bar-overlap']).toBe(
      ''
    );
    expect(gutterLine2BarStack.properties['data-decoration-bar-second']).toBe(
      ''
    );
    expect(
      gutterLine2BarStack.properties['data-decoration-bar-third']
    ).toBeUndefined();
    expect(gutterLine2BarStack.children).toHaveLength(0);
    expectStyleContains(gutterLine2BarStack.properties.style, [
      '--diffs-decoration-bar-width-1:6px;',
      '--diffs-decoration-bar-color-1:orange;',
      '--diffs-decoration-bar-start-radius-1:4px;',
      '--diffs-decoration-bar-end-radius-1:4px;',
      '--diffs-decoration-bar-width-2:10px;',
      'color-mix(in lab, green 74%, var(--diffs-bg))',
    ]);
    expect(gutterLine2.properties['data-decoration-bar-depth']).toBe('2');
    expect(gutterLine2.properties['data-decoration-bar-start']).toBe('2,3');
    expect(gutterLine2.properties['data-decoration-bar-end']).toBe('3');
    expect(gutterLine2.properties['data-decoration-bg']).toBeUndefined();
    expect(gutterLine2.properties['data-decoration-bg-depth']).toBeUndefined();
    expect(gutterLine2.properties.style).toBe(
      '--diffs-decoration-bar-color:orange;'
    );
    expect(gutterLine3.properties['data-decoration-bar']).toBe('1');
    expect(
      gutterLine3BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('1');
    expect(
      gutterLine3BarStack.properties['data-decoration-bar-overlap']
    ).toBeUndefined();
    expect(
      gutterLine3BarStack.properties['data-decoration-bar-second']
    ).toBeUndefined();
    expect(
      gutterLine3BarStack.properties['data-decoration-bar-third']
    ).toBeUndefined();
    expect(gutterLine3BarStack.children).toHaveLength(0);
    expectStyleContains(gutterLine3BarStack.properties.style, [
      '--diffs-decoration-bar-width-1:6px;',
      '--diffs-decoration-bar-color-1:green;',
      '--diffs-decoration-bar-end-radius-1:4px;',
      '--diffs-decoration-bar-shadow-3:none;',
    ]);
    expect(gutterLine3.properties['data-decoration-bar-depth']).toBe('1');
    expect(gutterLine3.properties['data-decoration-bar-start']).toBeUndefined();
    expect(gutterLine3.properties['data-decoration-bar-end']).toBe('1');

    expect(contentLine1.properties['data-decoration-bar']).toBeUndefined();
    expect(contentLine1.properties['data-decoration-bg-depth']).toBeUndefined();
    expect(contentLine1.properties['data-decoration-bg-start']).toBe('0,1');
    expect(contentLine1.properties['data-decoration-bg-end']).toBe('0');
    expect(contentLine2.properties['data-decoration-bar']).toBeUndefined();
    expect(contentLine2.properties['data-decoration-bg-start']).toBe('2,3');
    expect(contentLine2.properties['data-decoration-bg-end']).toBe('3');
    expect(contentLine2.properties['data-decoration-bg']).toBe('2,3');
    expect(contentLine2.properties['data-decoration-bg-depth']).toBe('2');
    expect(contentLine2.properties.style).toBe(
      '--diffs-decoration-bg:#123456;'
    );
    expect(contentLine3.properties['data-decoration-bar']).toBeUndefined();
    expect(contentLine3.properties['data-decoration-bg-start']).toBeUndefined();
    expect(contentLine3.properties['data-decoration-bg-end']).toBe('1');
    expect(contentLine3.properties['data-decoration-bg']).toBe('2');
    expect(contentLine3.properties['data-decoration-bg-depth']).toBe('1');
    expect(contentLine3.properties.style).toBe(
      '--diffs-decoration-bg:var(--diffs-modified-base);'
    );
  });

  test('file renderer keeps source-order identity but resolves the winner by line number', async () => {
    const file = {
      name: 'example.ts',
      contents: ['one', 'two', 'three', 'four'].join('\n'),
    };
    const decorations: FileDecorationItem[] = [
      { lineNumber: 2, endLineNumber: 4, background: '#111111' },
      { lineNumber: 1, endLineNumber: 3, background: '#222222' },
      { lineNumber: 2, background: '#333333' },
    ];

    const renderer = new FileRenderer();
    renderer.setDecorations(decorations);
    const result = await renderer.asyncRender(file);
    const codeAST = renderer.renderCodeAST(result) as HASTElement[];
    const [, content] = codeAST;
    assertDefined(content, 'expected content column');

    const contentLine2 = findElementByProperty(
      content.children,
      'data-line',
      2
    );
    const contentLine3 = findElementByProperty(
      content.children,
      'data-line',
      3
    );

    assertDefined(contentLine2, 'expected second content line');
    assertDefined(contentLine3, 'expected third content line');

    expect(contentLine2.properties['data-decoration-bg']).toBe('0,1,2');
    expect(contentLine2.properties['data-decoration-bg-depth']).toBe('3');
    expect(contentLine2.properties.style).toBe(
      '--diffs-decoration-bg:#333333;'
    );
    expect(contentLine3.properties['data-decoration-bg']).toBe('0,1');
    expect(contentLine3.properties['data-decoration-bg-depth']).toBe('2');
    expect(contentLine3.properties.style).toBe(
      '--diffs-decoration-bg:#111111;'
    );
  });

  test('file renderer keeps the visible bar when a higher overlapping decoration has no bar', async () => {
    const file = {
      name: 'example.ts',
      contents: ['one', 'two', 'three'].join('\n'),
    };
    const decorations: FileDecorationItem[] = [
      { lineNumber: 1, endLineNumber: 3, bar: true, color: 'red' },
      { lineNumber: 2, endLineNumber: 3, background: '#111111' },
    ];

    const renderer = new FileRenderer();
    renderer.setDecorations(decorations);
    const result = await renderer.asyncRender(file);
    const codeAST = renderer.renderCodeAST(result) as HASTElement[];
    const [gutter, content] = codeAST;
    assertDefined(gutter, 'expected gutter column');
    assertDefined(content, 'expected content column');

    const gutterLine2 = findElementByProperty(
      gutter.children,
      'data-column-number',
      2
    );
    const contentLine2 = findElementByProperty(
      content.children,
      'data-line',
      2
    );

    assertDefined(gutterLine2, 'expected second gutter line');
    assertDefined(contentLine2, 'expected second content line');

    const gutterLine2BarStack = findElementByProperty(
      gutterLine2.children,
      'data-decoration-bar-stack',
      ''
    );

    assertDefined(gutterLine2BarStack, 'expected second gutter bar stack');
    expect(gutterLine2.properties['data-decoration-bar']).toBe('0');
    expect(gutterLine2.properties['data-decoration-bar-depth']).toBe('1');
    expect(gutterLine2.properties.style).toBe(
      '--diffs-decoration-bar-color:red;'
    );
    expect(
      gutterLine2BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('1');
    expectStyleContains(gutterLine2BarStack.properties.style, [
      '--diffs-decoration-bar-color-1:red;',
      '--diffs-decoration-bar-width-1:6px;',
      '--diffs-decoration-bar-shadow-3:none;',
    ]);
    expect(contentLine2.properties['data-decoration-bg']).toBe('1');
    expect(contentLine2.properties.style).toBe(
      '--diffs-decoration-bg:#111111;'
    );
  });

  test('file renderer keeps one bar stack element while bar depth clamps at 3', async () => {
    const file = {
      name: 'example.ts',
      contents: ['one', 'two', 'three', 'four'].join('\n'),
    };
    const decorations: FileDecorationItem[] = [
      { lineNumber: 1, endLineNumber: 4, bar: true, color: 'red' },
      { lineNumber: 2, endLineNumber: 4, bar: true, color: 'blue' },
      { lineNumber: 2, endLineNumber: 4, bar: true, color: 'green' },
      { lineNumber: 3, endLineNumber: 4, bar: true, color: 'yellow' },
    ];

    const renderer = new FileRenderer();
    renderer.setDecorations(decorations);
    const result = await renderer.asyncRender(file);
    const codeAST = renderer.renderCodeAST(result) as HASTElement[];
    const [gutter] = codeAST;
    assertDefined(gutter, 'expected gutter column');

    const gutterLine4 = findElementByProperty(
      gutter.children,
      'data-column-number',
      4
    );

    assertDefined(gutterLine4, 'expected fourth gutter line');

    const gutterLine4BarStack = findElementByProperty(
      gutterLine4.children,
      'data-decoration-bar-stack',
      ''
    );

    assertDefined(gutterLine4BarStack, 'expected fourth gutter bar stack');
    expect(gutterLine4.properties['data-decoration-bar']).toBe('0,1,2,3');
    expect(gutterLine4.properties['data-decoration-bar-depth']).toBe('3');
    expect(
      gutterLine4BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('4');
    expect(gutterLine4BarStack.properties['data-decoration-bar-overlap']).toBe(
      ''
    );
    expect(gutterLine4BarStack.properties['data-decoration-bar-second']).toBe(
      ''
    );
    expect(gutterLine4BarStack.properties['data-decoration-bar-third']).toBe(
      ''
    );
    expect(gutterLine4BarStack.children).toHaveLength(0);
    expectStyleContains(gutterLine4BarStack.properties.style, [
      '--diffs-decoration-bar-width-1:6px;',
      '--diffs-decoration-bar-width-2:10px;',
      '--diffs-decoration-bar-width-3:14px;',
      '--diffs-decoration-bar-color-3:color-mix(in lab, blue 58%, var(--diffs-bg));',
      '--diffs-decoration-bar-shadow-3:0 0 0 2px var(--diffs-bg),-4px 0 0 2px var(--diffs-bg),-4px 0 0 0 color-mix(in lab, red 58%, var(--diffs-bg));',
    ]);
    expectStyleNotContains(gutterLine4BarStack.properties.style, [
      '--diffs-decoration-bar-color-4:',
    ]);
  });

  test('diff renderer collapses overlapping same-color bars into one continuous visual bar', async () => {
    const oldFile = {
      name: 'example.ts',
      contents: '',
    };
    const newFile = {
      name: 'example.ts',
      contents: Array.from(
        { length: 12 },
        (_, index) => `line ${index + 1}`
      ).join('\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const decorations: DiffDecorationItem[] = [
      {
        side: 'additions',
        lineNumber: 2,
        endLineNumber: 6,
        bar: true,
        background: 'red',
      },
      {
        side: 'additions',
        lineNumber: 5,
        endLineNumber: 11,
        bar: true,
        background: true,
      },
    ];

    const renderer = new DiffHunksRenderer({
      diffStyle: 'split',
      expandUnchanged: true,
    });
    renderer.setDecorations(decorations);
    const result = await renderer.asyncRender(diff);
    assertDefined(result.additionsGutterAST, 'expected additions gutter AST');

    const additionsLine5 = findElementByProperty(
      result.additionsGutterAST,
      'data-column-number',
      5
    );
    const additionsLine6 = findElementByProperty(
      result.additionsGutterAST,
      'data-column-number',
      6
    );

    assertDefined(additionsLine5, 'expected additions gutter line 5');
    assertDefined(additionsLine6, 'expected additions gutter line 6');

    const additionsLine5BarStack = findElementByProperty(
      additionsLine5.children,
      'data-decoration-bar-stack',
      ''
    );
    const additionsLine6BarStack = findElementByProperty(
      additionsLine6.children,
      'data-decoration-bar-stack',
      ''
    );

    assertDefined(
      additionsLine5BarStack,
      'expected additions line 5 bar stack'
    );
    assertDefined(
      additionsLine6BarStack,
      'expected additions line 6 bar stack'
    );

    expect(additionsLine5.properties['data-decoration-bar']).toBe('0,1');
    expect(additionsLine6.properties['data-decoration-bar']).toBe('0,1');
    expect(additionsLine5.properties['data-decoration-bar-depth']).toBe('2');
    expect(additionsLine6.properties['data-decoration-bar-depth']).toBe('2');
    expect(
      additionsLine5BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('1');
    expect(
      additionsLine6BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('1');
    expectStyleContains(additionsLine5BarStack.properties.style, [
      '--diffs-decoration-bar-color-1:var(--diffs-modified-base);',
      '--diffs-decoration-bar-width-1:6px;',
    ]);
    expectStyleContains(additionsLine6BarStack.properties.style, [
      '--diffs-decoration-bar-color-1:var(--diffs-modified-base);',
      '--diffs-decoration-bar-width-1:6px;',
    ]);
    expectStyleNotContains(additionsLine5BarStack.properties.style, [
      'color-mix(',
      '--diffs-decoration-bar-width-2:',
    ]);
    expectStyleNotContains(additionsLine6BarStack.properties.style, [
      'color-mix(',
      '--diffs-decoration-bar-width-2:',
    ]);
  });

  test('merged normalized decorations keep source-order identity and line-number winners', () => {
    const merged = mergeNormalizedLineDecorations(
      {
        backgroundIndices: [0],
        backgroundDepth: 1,
        backgroundColor: '#111111',
        backgroundLineNumber: 5,
        backgroundSourceIndex: 0,
      },
      {
        backgroundIndices: [1],
        backgroundDepth: 1,
        backgroundColor: '#222222',
        backgroundLineNumber: 3,
        backgroundSourceIndex: 1,
      }
    );

    assertDefined(merged, 'expected merged line decorations');
    expect(merged.backgroundIndices).toEqual([0, 1]);
    expect(merged.backgroundDepth).toBe(2);
    expect(merged.backgroundColor).toBe('#111111');
  });

  test('merged normalized decorations recompute bar end caps against merged visible order', () => {
    const merged = mergeNormalizedLineDecorations(
      {
        barIndices: [0],
        barDepth: 1,
        barColor: 'red',
        barLineNumber: 1,
        barSourceIndex: 0,
        barLayers: [
          {
            color: 'red',
            lineNumber: 1,
            endLineNumber: 1,
            sourceIndex: 0,
            showStartCap: true,
            showEndCap: true,
          },
        ],
      },
      {
        barIndices: [1],
        barDepth: 1,
        barColor: 'blue',
        barLineNumber: 2,
        barSourceIndex: 1,
        barLayers: [
          {
            color: 'blue',
            lineNumber: 2,
            endLineNumber: 3,
            sourceIndex: 1,
            showStartCap: false,
            showEndCap: false,
          },
        ],
      }
    );

    assertDefined(merged, 'expected merged line decorations');
    expect(merged.barDepth).toBe(2);
    expect(merged.barColor).toBe('blue');
    expect(merged.barLayers).toEqual([
      {
        color: 'red',
        lineNumber: 1,
        endLineNumber: 1,
        sourceIndex: 0,
        showStartCap: true,
        showEndCap: false,
      },
      {
        color: 'blue',
        lineNumber: 2,
        endLineNumber: 3,
        sourceIndex: 1,
        showStartCap: false,
        showEndCap: false,
      },
    ]);
  });

  test('merged normalized decorations keep all bar layers while clamping depth', () => {
    const merged = mergeNormalizedLineDecorations(
      {
        barIndices: [0, 1],
        barDepth: 2,
        barColor: 'blue',
        barLineNumber: 2,
        barSourceIndex: 1,
        barLayers: [
          {
            color: 'red',
            lineNumber: 1,
            endLineNumber: 4,
            sourceIndex: 0,
            showStartCap: false,
            showEndCap: true,
          },
          {
            color: 'blue',
            lineNumber: 2,
            endLineNumber: 4,
            sourceIndex: 1,
            showStartCap: false,
            showEndCap: true,
          },
        ],
      },
      {
        barIndices: [2, 3],
        barDepth: 2,
        barColor: 'yellow',
        barLineNumber: 3,
        barSourceIndex: 3,
        barLayers: [
          {
            color: 'green',
            lineNumber: 2,
            endLineNumber: 4,
            sourceIndex: 2,
            showStartCap: false,
            showEndCap: true,
          },
          {
            color: 'yellow',
            lineNumber: 3,
            endLineNumber: 4,
            sourceIndex: 3,
            showStartCap: false,
            showEndCap: true,
          },
        ],
      }
    );

    assertDefined(merged, 'expected merged line decorations');
    expect(merged.barDepth).toBe(3);
    expect(merged.barColor).toBe('yellow');
    expect(merged.barLayers).toEqual([
      {
        color: 'red',
        lineNumber: 1,
        endLineNumber: 4,
        sourceIndex: 0,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'blue',
        lineNumber: 2,
        endLineNumber: 4,
        sourceIndex: 1,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'green',
        lineNumber: 2,
        endLineNumber: 4,
        sourceIndex: 2,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'yellow',
        lineNumber: 3,
        endLineNumber: 4,
        sourceIndex: 3,
        showStartCap: false,
        showEndCap: true,
      },
    ]);
  });

  test('file normalization keeps all visible bar layers while clamping bar depth', () => {
    const normalized = normalizeFileDecorations<undefined>([
      { lineNumber: 1, endLineNumber: 4, bar: true, color: 'red' },
      { lineNumber: 2, endLineNumber: 4, bar: true, color: 'blue' },
      { lineNumber: 2, endLineNumber: 4, bar: true, color: 'green' },
      { lineNumber: 3, endLineNumber: 4, bar: true, color: 'yellow' },
    ]);

    const line2 = normalized[2];
    const line4 = normalized[4];

    assertDefined(line2, 'expected normalized line 2 decorations');
    assertDefined(line4, 'expected normalized line 4 decorations');

    expect(line2.barDepth).toBe(3);
    expect(line2.barColor).toBe('green');
    expect(line2.barLineNumber).toBe(2);
    expect(line2.barSourceIndex).toBe(2);
    expect(line2.barLayers).toEqual([
      {
        color: 'red',
        lineNumber: 1,
        endLineNumber: 4,
        sourceIndex: 0,
        showStartCap: false,
        showEndCap: false,
      },
      {
        color: 'blue',
        lineNumber: 2,
        endLineNumber: 4,
        sourceIndex: 1,
        showStartCap: true,
        showEndCap: false,
      },
      {
        color: 'green',
        lineNumber: 2,
        endLineNumber: 4,
        sourceIndex: 2,
        showStartCap: true,
        showEndCap: false,
      },
    ]);

    expect(line4.barIndices).toEqual([0, 1, 2, 3]);
    expect(line4.barDepth).toBe(3);
    expect(line4.barColor).toBe('yellow');
    expect(line4.barLineNumber).toBe(3);
    expect(line4.barSourceIndex).toBe(3);
    expect(line4.barLayers).toEqual([
      {
        color: 'red',
        lineNumber: 1,
        endLineNumber: 4,
        sourceIndex: 0,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'blue',
        lineNumber: 2,
        endLineNumber: 4,
        sourceIndex: 1,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'green',
        lineNumber: 2,
        endLineNumber: 4,
        sourceIndex: 2,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'yellow',
        lineNumber: 3,
        endLineNumber: 4,
        sourceIndex: 3,
        showStartCap: false,
        showEndCap: true,
      },
    ]);
  });

  test('file normalization hides lower bar end caps when a higher layer continues below', () => {
    const normalized = normalizeFileDecorations<undefined>([
      { lineNumber: 1, endLineNumber: 1, bar: true, color: 'red' },
      { lineNumber: 1, endLineNumber: 2, bar: true, color: 'blue' },
    ]);

    expect(normalized[1]?.barLayers).toEqual([
      {
        color: 'red',
        lineNumber: 1,
        endLineNumber: 1,
        sourceIndex: 0,
        showStartCap: true,
        showEndCap: false,
      },
      {
        color: 'blue',
        lineNumber: 1,
        endLineNumber: 2,
        sourceIndex: 1,
        showStartCap: true,
        showEndCap: false,
      },
    ]);
    expect(normalized[2]?.barLayers).toEqual([
      {
        color: 'blue',
        lineNumber: 1,
        endLineNumber: 2,
        sourceIndex: 1,
        showStartCap: false,
        showEndCap: true,
      },
    ]);
  });

  test('diff normalization keeps per-side visible bar layers', () => {
    const normalized = normalizeDiffDecorations<undefined>([
      {
        side: 'deletions',
        lineNumber: 1,
        endLineNumber: 2,
        bar: true,
        color: 'red',
      },
      {
        side: 'additions',
        lineNumber: 1,
        endLineNumber: 2,
        bar: true,
        color: 'blue',
      },
      {
        side: 'deletions',
        lineNumber: 2,
        endLineNumber: 2,
        bar: true,
        color: 'green',
      },
    ]);

    expect(normalized.deletions[2]?.barLayers).toEqual([
      {
        color: 'red',
        lineNumber: 1,
        endLineNumber: 2,
        sourceIndex: 0,
        showStartCap: false,
        showEndCap: true,
      },
      {
        color: 'green',
        lineNumber: 2,
        endLineNumber: 2,
        sourceIndex: 2,
        showStartCap: true,
        showEndCap: true,
      },
    ]);
    expect(normalized.deletions[2]?.barColor).toBe('green');
    expect(normalized.additions[2]?.barLayers).toEqual([
      {
        color: 'blue',
        lineNumber: 1,
        endLineNumber: 2,
        sourceIndex: 1,
        showStartCap: false,
        showEndCap: true,
      },
    ]);
    expect(normalized.additions[2]?.barColor).toBe('blue');
  });

  test('diff renderer keeps split decorations side-owned and combines unified overlaps', async () => {
    const oldFile = {
      name: 'example.ts',
      contents: ['keep', 'old only', 'shared'].join('\n'),
    };
    const newFile = {
      name: 'example.ts',
      contents: ['keep', 'new only', 'shared'].join('\n'),
    };
    const diff = parseDiffFromFile(oldFile, newFile);
    const decorations: DiffDecorationItem[] = [
      { side: 'deletions', lineNumber: 1, bar: true, color: 'red' },
      { side: 'additions', lineNumber: 1, bar: true, color: 'blue' },
      { side: 'deletions', lineNumber: 2, background: '#111111' },
      { side: 'additions', lineNumber: 2, background: '#222222' },
    ];

    const splitRenderer = new DiffHunksRenderer({
      diffStyle: 'split',
      expandUnchanged: true,
    });
    splitRenderer.setDecorations(decorations);
    const splitResult = await splitRenderer.asyncRender(diff);
    assertDefined(
      splitResult.deletionsGutterAST,
      'expected deletions gutter AST'
    );
    assertDefined(
      splitResult.additionsGutterAST,
      'expected additions gutter AST'
    );
    assertDefined(
      splitResult.deletionsContentAST,
      'expected deletions content AST'
    );
    assertDefined(
      splitResult.additionsContentAST,
      'expected additions content AST'
    );

    const splitDeletionLine1 = findElementByProperty(
      splitResult.deletionsGutterAST,
      'data-column-number',
      1
    );
    const splitAdditionLine1 = findElementByProperty(
      splitResult.additionsGutterAST,
      'data-column-number',
      1
    );
    const splitDeletionLine2Gutter = findElementByProperty(
      splitResult.deletionsGutterAST,
      'data-column-number',
      2
    );
    const splitAdditionLine2Gutter = findElementByProperty(
      splitResult.additionsGutterAST,
      'data-column-number',
      2
    );
    const splitDeletionLine2 = findElementByProperty(
      splitResult.deletionsContentAST,
      'data-line',
      2
    );
    const splitDeletionLine1Content = findElementByProperty(
      splitResult.deletionsContentAST,
      'data-line',
      1
    );
    const splitAdditionLine2 = findElementByProperty(
      splitResult.additionsContentAST,
      'data-line',
      2
    );
    const splitAdditionLine1Content = findElementByProperty(
      splitResult.additionsContentAST,
      'data-line',
      1
    );

    assertDefined(splitDeletionLine1, 'expected split deletions gutter line 1');
    assertDefined(splitAdditionLine1, 'expected split additions gutter line 1');
    assertDefined(
      splitDeletionLine2Gutter,
      'expected split deletions gutter line 2'
    );
    assertDefined(
      splitAdditionLine2Gutter,
      'expected split additions gutter line 2'
    );
    assertDefined(
      splitDeletionLine2,
      'expected split deletions content line 2'
    );
    assertDefined(
      splitDeletionLine1Content,
      'expected split deletions content line 1'
    );
    assertDefined(
      splitAdditionLine2,
      'expected split additions content line 2'
    );
    assertDefined(
      splitAdditionLine1Content,
      'expected split additions content line 1'
    );

    expect(splitDeletionLine1.properties['data-decoration-bar']).toBe('0');
    expect(splitDeletionLine1.properties['data-decoration-bar-depth']).toBe(
      '1'
    );
    expect(splitDeletionLine1.properties['data-decoration-bar-start']).toBe(
      '0'
    );
    expect(splitDeletionLine1.properties['data-decoration-bar-end']).toBe('0');
    expect(splitAdditionLine1.properties['data-decoration-bar']).toBe('1');
    expect(splitAdditionLine1.properties['data-decoration-bar-depth']).toBe(
      '1'
    );
    expect(splitAdditionLine1.properties['data-decoration-bar-start']).toBe(
      '1'
    );
    expect(splitAdditionLine1.properties['data-decoration-bar-end']).toBe('1');
    expect(
      splitDeletionLine1Content.properties['data-decoration-bg-start']
    ).toBe('0');
    expect(splitDeletionLine1Content.properties['data-decoration-bg-end']).toBe(
      '0'
    );
    expect(
      splitAdditionLine1Content.properties['data-decoration-bg-start']
    ).toBe('1');
    expect(splitAdditionLine1Content.properties['data-decoration-bg-end']).toBe(
      '1'
    );
    expect(
      splitDeletionLine2Gutter.properties['data-decoration-bar-start']
    ).toBe('2');
    expect(splitDeletionLine2Gutter.properties['data-decoration-bar-end']).toBe(
      '2'
    );
    expect(
      splitDeletionLine2Gutter.properties['data-decoration-bg']
    ).toBeUndefined();
    expect(
      splitDeletionLine2Gutter.properties['data-decoration-bg-depth']
    ).toBeUndefined();
    expect(splitDeletionLine2Gutter.properties.style).toBeUndefined();
    expect(
      splitAdditionLine2Gutter.properties['data-decoration-bar-start']
    ).toBe('3');
    expect(splitAdditionLine2Gutter.properties['data-decoration-bar-end']).toBe(
      '3'
    );
    expect(
      splitAdditionLine2Gutter.properties['data-decoration-bg']
    ).toBeUndefined();
    expect(
      splitAdditionLine2Gutter.properties['data-decoration-bg-depth']
    ).toBeUndefined();
    expect(splitAdditionLine2Gutter.properties.style).toBeUndefined();
    expect(splitDeletionLine2.properties['data-decoration-bg']).toBe('2');
    expect(splitDeletionLine2.properties['data-decoration-bg-depth']).toBe('1');
    expect(splitDeletionLine2.properties['data-decoration-bg-start']).toBe('2');
    expect(splitDeletionLine2.properties['data-decoration-bg-end']).toBe('2');
    expect(splitDeletionLine2.properties.style).toBe(
      '--diffs-decoration-bg:#111111;'
    );
    expect(splitAdditionLine2.properties['data-decoration-bg']).toBe('3');
    expect(splitAdditionLine2.properties['data-decoration-bg-depth']).toBe('1');
    expect(splitAdditionLine2.properties['data-decoration-bg-start']).toBe('3');
    expect(splitAdditionLine2.properties['data-decoration-bg-end']).toBe('3');
    expect(splitAdditionLine2.properties.style).toBe(
      '--diffs-decoration-bg:#222222;'
    );

    const unifiedRenderer = new DiffHunksRenderer({
      diffStyle: 'unified',
      expandUnchanged: true,
    });
    unifiedRenderer.setDecorations(decorations);
    const unifiedResult = await unifiedRenderer.asyncRender(diff);
    assertDefined(
      unifiedResult.unifiedGutterAST,
      'expected unified gutter AST'
    );
    assertDefined(
      unifiedResult.unifiedContentAST,
      'expected unified content AST'
    );

    const unifiedLine1Gutter = findElementByProperty(
      unifiedResult.unifiedGutterAST,
      'data-column-number',
      1
    );
    const unifiedLine1Content = findElementByProperty(
      unifiedResult.unifiedContentAST,
      'data-line',
      1
    );
    const unifiedLine2Deletion = findElementByProperties(
      unifiedResult.unifiedContentAST,
      {
        'data-line': 2,
        'data-line-type': 'change-deletion',
      }
    );
    const unifiedLine2Addition = findElementByProperties(
      unifiedResult.unifiedContentAST,
      {
        'data-line': 2,
        'data-line-type': 'change-addition',
      }
    );

    assertDefined(unifiedLine1Gutter, 'expected unified gutter line 1');
    assertDefined(unifiedLine1Content, 'expected unified content line 1');
    assertDefined(unifiedLine2Deletion, 'expected unified deletion line 2');
    assertDefined(unifiedLine2Addition, 'expected unified addition line 2');

    const unifiedLine1BarStack = findElementByProperty(
      unifiedLine1Gutter.children,
      'data-decoration-bar-stack',
      ''
    );

    assertDefined(unifiedLine1BarStack, 'expected unified gutter bar stack');

    expect(unifiedLine1Gutter.properties['data-decoration-bar']).toBe('0,1');
    expect(
      unifiedLine1BarStack.properties['data-decoration-bar-layer-count']
    ).toBe('2');
    expect(unifiedLine1BarStack.properties['data-decoration-bar-overlap']).toBe(
      ''
    );
    expect(unifiedLine1BarStack.properties['data-decoration-bar-second']).toBe(
      ''
    );
    expect(
      unifiedLine1BarStack.properties['data-decoration-bar-third']
    ).toBeUndefined();
    expect(unifiedLine1BarStack.children).toHaveLength(0);
    expectStyleContains(unifiedLine1BarStack.properties.style, [
      '--diffs-decoration-bar-width-1:6px;',
      '--diffs-decoration-bar-color-1:blue;',
      '--diffs-decoration-bar-start-radius-2:4px;',
      '--diffs-decoration-bar-end-radius-2:4px;',
      'color-mix(in lab, red 74%, var(--diffs-bg))',
    ]);
    expect(unifiedLine1Gutter.properties['data-decoration-bar-depth']).toBe(
      '2'
    );
    expect(unifiedLine1Gutter.properties['data-decoration-bar-start']).toBe(
      '0,1'
    );
    expect(unifiedLine1Gutter.properties['data-decoration-bar-end']).toBe(
      '0,1'
    );
    expect(unifiedLine1Gutter.properties.style).toBe(
      '--diffs-decoration-bar-color:blue;'
    );
    expect(unifiedLine1Content.properties['data-decoration-bg-start']).toBe(
      '0,1'
    );
    expect(unifiedLine1Content.properties['data-decoration-bg-end']).toBe(
      '0,1'
    );
    expect(unifiedLine2Deletion.properties['data-decoration-bg']).toBe('2');
    expect(unifiedLine2Deletion.properties['data-decoration-bg-depth']).toBe(
      '1'
    );
    expect(unifiedLine2Deletion.properties['data-decoration-bg-start']).toBe(
      '2'
    );
    expect(unifiedLine2Deletion.properties['data-decoration-bg-end']).toBe('2');
    expect(unifiedLine2Deletion.properties.style).toBe(
      '--diffs-decoration-bg:#111111;'
    );
    expect(unifiedLine2Addition.properties['data-decoration-bg']).toBe('3');
    expect(unifiedLine2Addition.properties['data-decoration-bg-depth']).toBe(
      '1'
    );
    expect(unifiedLine2Addition.properties['data-decoration-bg-start']).toBe(
      '3'
    );
    expect(unifiedLine2Addition.properties['data-decoration-bg-end']).toBe('3');
    expect(unifiedLine2Addition.properties.style).toBe(
      '--diffs-decoration-bg:#222222;'
    );
  });

  test('unresolved renderer merges decoration attrs with merge conflict attrs', async () => {
    const file = {
      name: 'conflict.ts',
      contents: [
        'const before = true;',
        '<<<<<<< HEAD',
        'const ours = true;',
        '=======',
        'const theirs = true;',
        '>>>>>>> topic',
        'const after = true;',
      ].join('\n'),
    };
    const { fileDiff, actions, markerRows } =
      parseMergeConflictDiffFromFile(file);
    const decorations: DiffDecorationItem[] = [
      {
        side: 'deletions',
        lineNumber: 2,
        bar: true,
        background: '#111111',
        color: 'red',
      },
      {
        side: 'additions',
        lineNumber: 2,
        bar: true,
        background: '#222222',
        color: 'blue',
      },
    ];

    const renderer = new UnresolvedFileHunksRenderer({ expandUnchanged: true });
    renderer.setDecorations(decorations);
    renderer.setConflictState(actions, markerRows, fileDiff);

    const result = await renderer.asyncRender(fileDiff);
    assertDefined(result.unifiedGutterAST, 'expected unified gutter AST');
    assertDefined(result.unifiedContentAST, 'expected unified content AST');

    const currentGutter = findElementByProperties(result.unifiedGutterAST, {
      'data-column-number': 2,
      'data-merge-conflict': 'current',
    });
    const incomingGutter = findElementByProperties(result.unifiedGutterAST, {
      'data-column-number': 2,
      'data-merge-conflict': 'incoming',
    });
    const currentLine = findElementByProperties(result.unifiedContentAST, {
      'data-line': 2,
      'data-merge-conflict': 'current',
    });
    const incomingLine = findElementByProperties(result.unifiedContentAST, {
      'data-line': 2,
      'data-merge-conflict': 'incoming',
    });

    assertDefined(currentGutter, 'expected current conflict gutter line');
    assertDefined(incomingGutter, 'expected incoming conflict gutter line');
    assertDefined(currentLine, 'expected current conflict content line');
    assertDefined(incomingLine, 'expected incoming conflict content line');

    expect(currentGutter.properties['data-decoration-bar']).toBe('0');
    expect(currentGutter.properties['data-decoration-bar-depth']).toBe('1');
    expect(currentGutter.properties['data-decoration-bar-start']).toBe('0');
    expect(currentGutter.properties['data-decoration-bar-end']).toBe('0');
    expect(currentGutter.properties['data-decoration-bg']).toBeUndefined();
    expect(currentGutter.properties['data-merge-conflict']).toBe('current');
    expect(currentGutter.properties.style).toBe(
      '--diffs-decoration-bar-color:red;'
    );
    expect(incomingGutter.properties['data-decoration-bar']).toBe('1');
    expect(incomingGutter.properties['data-decoration-bar-depth']).toBe('1');
    expect(incomingGutter.properties['data-decoration-bar-start']).toBe('1');
    expect(incomingGutter.properties['data-decoration-bar-end']).toBe('1');
    expect(incomingGutter.properties['data-decoration-bg']).toBeUndefined();
    expect(incomingGutter.properties['data-merge-conflict']).toBe('incoming');
    expect(incomingGutter.properties.style).toBe(
      '--diffs-decoration-bar-color:blue;'
    );
    expect(currentLine.properties['data-decoration-bg']).toBe('0');
    expect(currentLine.properties['data-decoration-bg-depth']).toBe('1');
    expect(currentLine.properties['data-decoration-bg-start']).toBe('0');
    expect(currentLine.properties['data-decoration-bg-end']).toBe('0');
    expect(currentLine.properties['data-merge-conflict']).toBe('current');
    expect(currentLine.properties.style).toBe('--diffs-decoration-bg:#111111;');
    expect(incomingLine.properties['data-decoration-bg']).toBe('1');
    expect(incomingLine.properties['data-decoration-bg-depth']).toBe('1');
    expect(incomingLine.properties['data-decoration-bg-start']).toBe('1');
    expect(incomingLine.properties['data-decoration-bg-end']).toBe('1');
    expect(incomingLine.properties['data-merge-conflict']).toBe('incoming');
    expect(incomingLine.properties.style).toBe(
      '--diffs-decoration-bg:#222222;'
    );
  });
});

function findElementByProperty(
  nodes: ElementContent[],
  property: string,
  value: string | number
): HASTElement | undefined {
  return findElementByProperties(nodes, { [property]: value });
}

function expectStyleContains(style: unknown, expectedParts: string[]): void {
  expect(typeof style).toBe('string');
  for (const expectedPart of expectedParts) {
    expect(style).toContain(expectedPart);
  }
}

function expectStyleNotContains(
  style: unknown,
  unexpectedParts: string[]
): void {
  expect(typeof style).toBe('string');
  for (const unexpectedPart of unexpectedParts) {
    expect(style).not.toContain(unexpectedPart);
  }
}

function findElementByProperties(
  nodes: ElementContent[],
  properties: Record<string, string | number>
): HASTElement | undefined {
  for (const node of collectAllElements(nodes)) {
    if (!matchesProperties(node, properties)) {
      continue;
    }
    return node;
  }
  return undefined;
}

function matchesProperties(
  node: HASTElement,
  properties: Record<string, string | number>
): boolean {
  return Object.entries(properties).every(([key, value]) => {
    return node.properties?.[key] === value;
  });
}
