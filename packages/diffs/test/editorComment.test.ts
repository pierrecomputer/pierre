import { describe, expect, test } from 'bun:test';

import { resolveCommentConfig } from '../src/editor/languages';
import { getFiletypeFromFileName } from '../src/utils/getFiletypeFromFileName';

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
    expect(resolveCommentConfig('makefile')).toEqual({
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

  test('uses comment configs for resolved file language ids', () => {
    const cases = [
      ['script.sh', '#'],
      ['build.bat', '@REM'],
      ['Makefile', '#'],
      ['Dockerfile', '#'],
      ['README.rst', '..'],
      ['paper.tex', '%'],
      ['config.yml', '#'],
    ] as const;

    for (const [fileName, lineComment] of cases) {
      expect(
        resolveCommentConfig(getFiletypeFromFileName(fileName)).lineComment
      ).toBe(lineComment);
    }
  });
});
