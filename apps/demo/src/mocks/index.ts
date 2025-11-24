import type {
  DiffLineAnnotation,
  FileStreamOptions,
  LineAnnotation,
} from '@pierre/precision-diffs';

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
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      ...createHighlighterCleanup(),
    } satisfies FileStreamOptions,
  },
  {
    content: mdContent,
    letterByLetter: true,
    options: {
      lang: 'markdown',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      ...createHighlighterCleanup(),
    } satisfies FileStreamOptions,
  },
] as const;

export const FILE_OLD = fileOld;
export const FILE_NEW = fileNew;

export interface LineCommentMetadata {
  author: string;
  message: string;
}

export const FAKE_LINE_ANNOTATIONS: LineAnnotation<LineCommentMetadata>[] = [
  {
    lineNumber: 2,
    metadata: {
      author: 'Sarah Chen (line-2)',
      message: 'Consider refactoring this for better performance',
    },
  },
  {
    lineNumber: 4,
    metadata: {
      author: 'Marcus Rodriguez (line-4)',
      message: 'Why are we removing this functionality?',
    },
  },
  {
    lineNumber: 4,
    metadata: {
      author: 'Olivia Kim (line-4)',
      message: 'This was deprecated last quarter, good catch',
    },
  },
  {
    lineNumber: 6,
    metadata: {
      author: 'Raj Patel (line-6)',
      message: 'We should add unit tests for this change',
    },
  },
  {
    lineNumber: 9,
    metadata: {
      author: 'Emma Thompson (line-9)',
      message: 'Nice improvement! This should handle edge cases better',
    },
  },
  {
    lineNumber: 11,
    metadata: {
      author: 'David Johnson (line-11)',
      message: 'This could break backward compatibility',
    },
  },
  {
    lineNumber: 13,
    metadata: {
      author: 'Sofia Martinez (line-13)',
      message: 'Finally cleaning up legacy code!',
    },
  },
  {
    lineNumber: 15,
    metadata: {
      author: 'Alex Turner (line-15)',
      message: 'Does this follow our style guide?',
    },
  },
];

export const FAKE_DIFF_LINE_ANNOTATIONS: DiffLineAnnotation<LineCommentMetadata>[][][] =
  [
    [
      [
        {
          lineNumber: 2,
          side: 'additions',
          metadata: {
            author: 'Sarah Chen (additions-2)',
            message: 'Consider refactoring this for better performance',
          },
        },
        {
          lineNumber: 4,
          side: 'deletions',
          metadata: {
            author: 'Marcus Rodriguez (deletions-4)',
            message: 'Why are we removing this functionality?',
          },
        },
        {
          lineNumber: 9,
          side: 'additions',
          metadata: {
            author: 'Emma Thompson (additions-9)',
            message: 'Nice improvement! This should handle edge cases better',
          },
        },
        {
          lineNumber: 6,
          side: 'additions',
          metadata: {
            author: 'Raj Patel (additions-6)',
            message: 'We should add unit tests for this change',
          },
        },
        {
          lineNumber: 5,
          side: 'deletions',
          metadata: {
            author: 'Olivia Kim (deletions-5)',
            message: 'This was deprecated last quarter, good catch',
          },
        },
        {
          lineNumber: 15,
          side: 'additions',
          metadata: {
            author: 'Alex Turner (additions-15)',
            message: 'Does this follow our style guide?',
          },
        },
        {
          lineNumber: 13,
          side: 'deletions',
          metadata: {
            author: 'Sofia Martinez (deletions-13)',
            message: 'Finally cleaning up legacy code!',
          },
        },
        {
          lineNumber: 11,
          side: 'deletions',
          metadata: {
            author: 'David Johnson (deletions-11)',
            message: 'This could break backward compatibility',
          },
        },
      ],
      [
        {
          lineNumber: 5,
          side: 'additions',
          metadata: {
            author: "Liam O'Brien (additions-5)",
            message: 'LGTM, ship it! 🚀',
          },
        },
      ],
    ],
  ];
