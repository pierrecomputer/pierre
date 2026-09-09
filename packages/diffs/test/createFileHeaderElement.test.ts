import { describe, expect, test } from 'bun:test';

import { createFileHeaderElement } from '../src/utils/createFileHeaderElement';
import { rowProperties } from './testUtils';

describe('createFileHeaderElement', () => {
  test('renders default file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
      stickyHeader: false,
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
      stickyHeader: false,
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
      stickyHeader: false,
    });

    expect(header).toMatchSnapshot();
  });

  test('renders sticky file header AST', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'src/index.ts',
        contents: 'export {}\n',
      },
      mode: 'default',
      stickyHeader: true,
    });

    expect(rowProperties(header)['data-sticky']).toBe('');
    expect(header).toMatchSnapshot();
  });
});
