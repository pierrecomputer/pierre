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

    expect(header.properties?.['data-sticky']).toBe('');
    expect(header).toMatchSnapshot();
  });

  test('omits counts for zero-hunk diffs', () => {
    const header = createFileHeaderElement({
      fileOrDiff: {
        name: 'assets/app-icon.png',
        type: 'change',
        hunks: [],
        splitLineCount: 0,
        unifiedLineCount: 0,
        isPartial: true,
        deletionLines: [],
        additionLines: [],
      },
      mode: 'default',
      stickyHeader: false,
    });

    expect(header).toMatchSnapshot();
  });
});
