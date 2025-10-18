import type { CodeRendererOptions, LineAnnotation } from '@pierre/precision-diffs';

import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';
import fileNew from './fileNew.txt?raw';
import fileOld from './fileOld.txt?raw';

export { mdContent, tsContent };

export const CodeConfigs = [
  {
    content: tsContent,
    letterByLetter: false,
    options: {
      lang: 'tsx',
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      defaultColor: false,
      ...createHighlighterCleanup(),
    } satisfies CodeRendererOptions,
  },
  {
    content: mdContent,
    letterByLetter: true,
    options: {
      lang: 'markdown',
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      defaultColor: false,
      ...createHighlighterCleanup(),
    } satisfies CodeRendererOptions,
  },
] as const;

export const FILE_OLD = fileOld;
export const FILE_NEW = fileNew;

export interface LineCommentMetadata {
  author: string;
  message: string;
}

export const FAKE_LINE_ANNOTATIONS: LineAnnotation<LineCommentMetadata>[][][] =
  [
    [
      [
        {
          lineNumber: 2,
          side: 'additions',
          metadata: {
            author: 'Sarah Chen',
            message: 'Consider refactoring this for better performance',
          },
        },
        {
          lineNumber: 4,
          side: 'deletions',
          metadata: {
            author: 'Marcus Rodriguez',
            message: 'Why are we removing this functionality?',
          },
        },
        {
          lineNumber: 9,
          side: 'additions',
          metadata: {
            author: 'Emma Thompson',
            message: 'Nice improvement! This should handle edge cases better',
          },
        },
        {
          lineNumber: 6,
          side: 'additions',
          metadata: {
            author: 'Raj Patel',
            message: 'We should add unit tests for this change',
          },
        },
        {
          lineNumber: 5,
          side: 'deletions',
          metadata: {
            author: 'Olivia Kim',
            message: 'This was deprecated last quarter, good catch',
          },
        },
        {
          lineNumber: 15,
          side: 'additions',
          metadata: {
            author: 'Alex Turner',
            message: 'Does this follow our style guide?',
          },
        },
        {
          lineNumber: 13,
          side: 'deletions',
          metadata: {
            author: 'Sofia Martinez',
            message: 'Finally cleaning up legacy code!',
          },
        },
        {
          lineNumber: 11,
          side: 'deletions',
          metadata: {
            author: 'David Johnson',
            message: 'This could break backward compatibility',
          },
        },
      ],
      [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: { author: "Liam O'Brien", message: 'LGTM, ship it! 🚀' },
        },
      ],
    ],
  ];
