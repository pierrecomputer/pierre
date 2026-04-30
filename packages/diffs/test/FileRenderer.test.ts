import { afterAll, describe, expect, test } from 'bun:test';

import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import { FileRenderer } from '../src/renderers/FileRenderer';
import { mockFiles } from './mocks';

afterAll(async () => {
  await disposeHighlighter();
});

describe('FileRenderer', () => {
  test('should render TypeScript code to AST matching snapshot', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file1);
    expect(instance.renderCodeAST(result)).toMatchSnapshot();
  });
});
