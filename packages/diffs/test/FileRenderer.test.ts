import { describe, expect, test } from 'bun:test';

import { FileRenderer } from '../src/renderers/FileRenderer';
import { mockFiles } from './mocks';

describe('FileRenderer', () => {
  test('should render TypeScript code to AST matching snapshot', async () => {
    const instance = new FileRenderer();
    const result = await instance.asyncRender(mockFiles.file1);
    expect(instance.renderCodeAST(result)).toMatchSnapshot();
  });
});
