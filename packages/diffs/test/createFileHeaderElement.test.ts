import { describe, expect, test } from 'bun:test';

import { createFileHeaderElement } from '../src/utils/createFileHeaderElement';

describe('createFileHeaderElement', () => {
  test('renders default file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
    });

    expect(header).toMatchSnapshot();
  });

  test('renders default renamed file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        prevName: 'src/old-index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
    });

    expect(header).toMatchSnapshot();
  });

  test('renders custom file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'custom',
    });

    expect(header).toMatchSnapshot();
  });
});
