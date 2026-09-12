import { afterAll, describe, expect, test } from 'bun:test';
import type { Element, ElementContent } from 'hast';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { FileRenderer } from '../src/renderers/FileRenderer';
import type { LineAnnotation } from '../src/types';
import { mockFiles } from './mocks';
import { assertDefined, findHastSlotElements } from './testUtils';

afterAll(async () => {
  await disposeHighlighter();
});

describe('FileRenderer AST Structure', () => {
  test('should generate correct AST structure for JavaScript file', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);
    const { totalLines } = result;
    const codeAST = instance.renderCodeAST(result);

    // Verify line count matches
    const inputLines = mockFiles.file2.contents.split('\n').length;
    expect(totalLines).toBe(inputLines);

    // Structure: [gutter, contentColumn]
    expect(codeAST.length).toBe(2);

    const [gutter, contentColumn] = codeAST as Element[];

    // Verify gutter structure
    expect(gutter.type).toBe('element');
    expect(gutter.tagName).toBe('div');
    assertDefined(gutter.properties, 'gutter.properties should be defined');
    expect(gutter.properties['data-gutter']).toBe('');
    assertDefined(gutter.children, 'gutter.children should be defined');
    expect(gutter.children.length).toBe(inputLines);

    // Verify content column structure
    expect(contentColumn.type).toBe('element');
    expect(contentColumn.tagName).toBe('div');
    assertDefined(
      contentColumn.properties,
      'contentColumn.properties should be defined'
    );
    expect(contentColumn.properties['data-content']).toBe('');
    assertDefined(
      contentColumn.children,
      'contentColumn.children should be defined'
    );
    expect(contentColumn.children.length).toBe(inputLines);

    // Verify each line in the content column
    for (let i = 0; i < contentColumn.children.length; i++) {
      const lineElement = contentColumn.children[i] as Element;

      // Each line should be a div element
      expect(lineElement.type).toBe('element');
      expect(lineElement.tagName).toBe('div');

      // Each line should have the correct properties
      assertDefined(
        lineElement.properties,
        'lineElement.properties should be defined'
      );
      expect(lineElement.properties['data-line']).toBe(i + 1);
      expect(lineElement.properties['data-line-type']).toBe('context');
      expect(lineElement.properties['data-line-index']).toBe(i);
    }

    // Verify each gutter item
    for (let i = 0; i < gutter.children.length; i++) {
      const gutterItem = gutter.children[i] as Element;

      // Each gutter item should be a div element
      expect(gutterItem.type).toBe('element');
      expect(gutterItem.tagName).toBe('div');

      // Each gutter item should have the correct properties
      assertDefined(
        gutterItem.properties,
        'gutterItem.properties should be defined'
      );
      expect(gutterItem.properties['data-column-number']).toBe(i + 1);
      expect(gutterItem.properties['data-line-type']).toBe('context');
      expect(gutterItem.properties['data-line-index']).toBe(`${i}`);
    }
  });

  test('should apply syntax highlighting with CSS variables', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);
    const codeAST = instance.renderCodeAST(result);

    // Helper to recursively find all text nodes with their parent styles
    const findTextNodesWithStyles = (
      nodes: ElementContent[]
    ): Array<{ text: string; style?: string }> => {
      const results: Array<{ text: string; style?: string }> = [];

      const traverse = (node: ElementContent, parentStyle?: string) => {
        if (node.type === 'text') {
          results.push({ text: node.value, style: parentStyle });
        } else if (node.type === 'element') {
          const style =
            typeof node.properties?.style === 'string'
              ? node.properties.style
              : undefined;
          node.children?.forEach((child) =>
            traverse(child, style ?? parentStyle)
          );
        }
      };

      nodes.forEach((node) => traverse(node));
      return results;
    };

    const textNodes = findTextNodesWithStyles(codeAST);

    // Verify that at least some tokens have syntax highlighting with CSS variables
    const styledTokens = textNodes.filter((node) => node.style !== undefined);
    expect(styledTokens.length).toBeGreaterThan(0);

    // Verify that styled tokens have the expected CSS variable format
    const tokensWithCSSVars = styledTokens.filter(
      (node) =>
        node.style?.match(
          /--diffs-token-dark:#[A-F0-9]{6};--diffs-token-light:#[A-F0-9]{6}/
        ) !== null
    );
    expect(tokensWithCSSVars.length).toBeGreaterThan(0);

    // Verify specific keyword exists and is highlighted
    const functionToken = textNodes.find((node) => node.text === 'function');
    assertDefined(functionToken, 'functionToken should be defined');
    assertDefined(functionToken.style, 'functionToken.style should be defined');
    expect(functionToken.style).toMatch(
      /--diffs-token-dark:#[A-F0-9]{6};--diffs-token-light:#[A-F0-9]{6}/
    );
  });

  test('should generate correct totalLines count', async () => {
    const instance = new FileRenderer();

    // file2's totalLines is asserted in the AST structure test above; this
    // covers the TypeScript fixture
    const result = await instance.asyncRender(mockFiles.file1);
    const file1Lines = mockFiles.file1.contents.split('\n').length;
    expect(result.totalLines).toBe(file1Lines);
  });

  test('should render one content line when the buffer ends with a newline', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender({
      name: 'single-line.txt',
      contents: 'hello\n',
    });
    const [gutter, contentColumn] = instance.renderCodeAST(result) as Element[];

    expect(result.totalLines).toBe(2);
    expect(result.rowCount).toBe(2);
    expect(gutter.children).toHaveLength(2);
    expect(contentColumn.children).toHaveLength(2);
  });

  test('css is always empty in the non-worker render path', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);
    // processFileResult hardcodes css: '' here; only the worker pipeline
    // produces theme CSS. If this ever changes, the renderer contract changed
    expect(result.css).toBe('');
  });

  test('renders file-level annotations before the first file line', async () => {
    const instance = new FileRenderer<string>();
    const annotations: LineAnnotation<string>[] = [
      { lineNumber: 0, metadata: 'file' },
      { lineNumber: 2, metadata: 'line' },
    ];
    instance.setLineAnnotations(annotations);

    const result = await instance.asyncRender(mockFiles.file2);
    const codeAST = instance.renderCodeAST(result);
    const [gutter, contentColumn] = codeAST as Element[];
    const firstContent = contentColumn.children[0] as Element;
    const secondContent = contentColumn.children[1] as Element;
    const firstGutter = gutter.children[0] as Element;

    expect(firstContent.properties?.['data-line-annotation']).toBe('-1,-1');
    expect(
      findHastSlotElements(firstContent).map((slot) => slot.properties?.name)
    ).toEqual(['annotation-0']);
    expect(secondContent.properties?.['data-line']).toBe(1);
    expect(firstGutter.properties?.['data-gutter-buffer']).toBe('annotation');
  });

  test('does not render file-level annotations in non-top render chunks', async () => {
    const instance = new FileRenderer<string>();
    instance.setLineAnnotations([{ lineNumber: 0, metadata: 'file' }]);

    const result = await instance.asyncRender(mockFiles.file2, {
      startingLine: 1,
      totalLines: 2,
      bufferBefore: 0,
      bufferAfter: 0,
    });
    const codeAST = instance.renderCodeAST(result);
    const [, contentColumn] = codeAST as Element[];
    const firstContent = contentColumn.children[0] as Element;

    expect(firstContent.properties?.['data-line']).toBe(2);
    expect(
      contentColumn.children.some(
        (child) =>
          child.type === 'element' &&
          child.properties?.['data-line-annotation'] === '-1,-1'
      )
    ).toBe(false);
  });

  test('should create preNode with correct properties', async () => {
    const instance = new FileRenderer();
    const { preAST, totalLines } = await instance.asyncRender(mockFiles.file2);
    expect(preAST.type).toBe('element');
    expect(preAST.tagName).toBe('pre');
    assertDefined(preAST.properties, 'preAST.properties should be defined');
    // File renders are marked data-file (not data-diff) and scrollable
    expect(preAST.properties['data-file']).toBe('');
    expect(preAST.properties['data-diff']).toBeUndefined();
    expect(preAST.properties['data-overflow']).toBe('scroll');
    // The pre is intentionally not focusable (no tabindex); the host owns focus.
    expect(preAST.properties.tabIndex).toBeUndefined();
    // The gutter width var reserves one ch per digit of the line count
    expect(preAST.properties.style).toBe(
      `--diffs-min-number-column-width-default:${`${totalLines}`.length}ch;`
    );
  });
});
