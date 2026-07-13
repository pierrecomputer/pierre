import { describe, expect, test } from 'bun:test';

import { resolveCommentConfig } from '../src/editor/languages';

describe('resolveCommentConfig', () => {
  test('uses modern-monaco language comment tokens', () => {
    expect(resolveCommentConfig('ruby')).toEqual({
      lineComment: '#',
      blockComment: ['=begin', '=end'],
    });
    expect(resolveCommentConfig('markdown')).toEqual({
      lineComment: null,
      blockComment: ['<!--', '-->'],
    });
    expect(resolveCommentConfig('make')).toEqual({
      lineComment: '#',
      blockComment: ['/*', '*/'],
    });
    expect(resolveCommentConfig('css')).toEqual({
      lineComment: null,
      blockComment: ['/*', '*/'],
    });

    const overrides = {
      custom: { lineComment: '#', blockComment: ['<#', '#>'] },
    } as const;
    expect(resolveCommentConfig('custom', overrides)).toEqual({
      lineComment: '#',
      blockComment: ['<#', '#>'],
    });
  });
});
