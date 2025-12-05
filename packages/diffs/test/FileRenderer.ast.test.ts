import { describe, expect, test } from 'bun:test';
import type { Element, ElementContent } from 'hast';

import { FileRenderer } from '../src/FileRenderer';
import { mockFiles } from './mocks';

describe('FileRenderer AST Structure', () => {
  test('should generate correct AST structure for JavaScript file', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);

    expect(result).toBeDefined();
    const { codeAST, totalLines } = result;

    // Verify line count matches
    const inputLines = mockFiles.file2.contents.split('\n').length;
    expect(totalLines).toBe(inputLines);
    expect(codeAST.length).toBe(inputLines);

    // Verify each line has the expected structure
    for (let i = 0; i < codeAST.length; i++) {
      const lineElement = codeAST[i] as Element;

      // Each line should be a div element
      expect(lineElement.type).toBe('element');
      expect(lineElement.tagName).toBe('div');

      // Each line should have the correct properties
      expect(lineElement.properties).toBeDefined();
      expect(lineElement.properties['data-line']).toBe(i + 1);
      expect(lineElement.properties['data-line-type']).toBe('context');
      expect(lineElement.properties['data-line-index']).toBe(i);

      // Each line should have two child spans: column-number and column-content
      expect(lineElement.children).toBeDefined();
      expect(lineElement.children.length).toBe(2);

      const [numberColumn, contentColumn] = lineElement.children as Element[];

      // Verify line number column
      expect(numberColumn.type).toBe('element');
      expect(numberColumn.tagName).toBe('span');
      expect(numberColumn.properties['data-column-number']).toBe('');

      // Verify content column
      expect(contentColumn.type).toBe('element');
      expect(contentColumn.tagName).toBe('span');
      expect(contentColumn.properties['data-column-content']).toBe('');
    }
  });

  test('should apply syntax highlighting with CSS variables', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);

    expect(result).toBeDefined();
    const { codeAST } = result;

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
          /--pjs-dark:#[A-F0-9]{6};--pjs-light:#[A-F0-9]{6}/
        ) !== null
    );
    expect(tokensWithCSSVars.length).toBeGreaterThan(0);

    // Verify specific keyword exists and is highlighted
    const functionToken = textNodes.find((node) => node.text === 'function');
    expect(functionToken).toBeDefined();
    expect(functionToken!.style).toBeDefined();
    expect(functionToken!.style).toMatch(
      /--pjs-dark:#[A-F0-9]{6};--pjs-light:#[A-F0-9]{6}/
    );
  });

  test('should generate correct totalLines count', async () => {
    const instance = new FileRenderer();

    // Test file1 (TypeScript)
    const result1 = await instance.asyncRender(mockFiles.file1);
    expect(result1).toBeDefined();
    const file1Lines = mockFiles.file1.contents.split('\n').length;
    expect(result1.totalLines).toBe(file1Lines);

    // Test file2 (JavaScript)
    const result2 = await instance.asyncRender(mockFiles.file2);
    expect(result2).toBeDefined();
    const file2Lines = mockFiles.file2.contents.split('\n').length;
    expect(result2.totalLines).toBe(file2Lines);
  });

  test('should include CSS property in result', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);

    expect(result).toBeDefined();
    expect(result.css).toBeDefined();
    expect(typeof result.css).toBe('string');
    // CSS may be empty string depending on theme configuration
  });

  test('should create preNode with correct properties', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file2);

    expect(result).toBeDefined();
    const { preAST } = result;

    expect(preAST.type).toBe('element');
    expect(preAST.tagName).toBe('pre');
    expect(preAST.properties).toBeDefined();
  });
});
