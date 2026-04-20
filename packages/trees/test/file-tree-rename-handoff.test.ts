import { describe, expect, test } from 'bun:test';

import { classifyFileTreeRenameHandoff } from '../src/render/fileTreeRenameHandoff';

describe('classifyFileTreeRenameHandoff', () => {
  test('returns reset when no rename is active', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: false,
        previousRenamingPath: null,
        renamingPath: null,
      })
    ).toBe('reset');
  });

  test('returns reset even when a previous rename was tracked, so refs can clear', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: true,
        previousRenamingPath: 'src/lib/',
        renamingPath: null,
      })
    ).toBe('reset');
  });

  test('requests a canonical reveal when rename starts but no input has rendered yet', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: false,
        previousRenamingPath: null,
        renamingPath: 'src/lib/',
      })
    ).toBe('reveal-canonical');
  });

  test('requests a canonical reveal even when a previous rename leaves stale tracking', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: false,
        previousRenamingPath: 'src/lib/',
        renamingPath: 'src/other/',
      })
    ).toBe('reveal-canonical');
  });

  test('focuses the rendered input for a newly-started rename', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: true,
        previousRenamingPath: null,
        renamingPath: 'src/lib/',
      })
    ).toBe('focus-input');
  });

  test('focuses the rendered input when switching between renames', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: true,
        previousRenamingPath: 'src/lib/',
        renamingPath: 'src/other/',
      })
    ).toBe('focus-input');
  });

  test('ignores re-runs when the same rename has already been focused', () => {
    expect(
      classifyFileTreeRenameHandoff({
        hasRenderedInput: true,
        previousRenamingPath: 'src/lib/',
        renamingPath: 'src/lib/',
      })
    ).toBe('ignore');
  });
});
