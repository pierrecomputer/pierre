import { describe, expect, test } from 'bun:test';

import { FileRenderer } from '../src/FileRenderer';
import { mockFiles } from './mocks';

describe('FileRenderer', () => {
  test('should render TypeScript code to AST matching snapshot', async () => {
    const instance = new FileRenderer();
    const result = await instance.render(mockFiles.file1);

    expect(result).toBeDefined();
    expect(result?.codeAST).toMatchSnapshot();
  });
});
