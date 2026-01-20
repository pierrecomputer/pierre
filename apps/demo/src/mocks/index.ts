import type {
  DiffLineAnnotation,
  FileStreamOptions,
  LineAnnotation,
} from '@pierre/diffs';

import { createHighlighterCleanup } from '../utils/createHighlighterCleanup';
import mdContent from './example_md.txt?raw';
import tsContent from './example_ts.txt?raw';
import fileAnsi from './fileAnsi.txt?raw';
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
export const FILE_ANSI = fileAnsi;

export interface LineCommentMetadata {
  author: string;
  message: string;
}

export const FAKE_LINE_ANNOTATIONS: LineAnnotation<LineCommentMetadata>[] = [
  {
    lineNumber: 2,
    metadata: {
      author: 'Sarah Chen',
      message: 'Consider refactoring this for better performance',
    },
  },
  {
    lineNumber: 4,
    metadata: {
      author: 'Marcus Rodriguez',
      message: 'Why are we removing this functionality?',
    },
  },
  {
    lineNumber: 4,
    metadata: {
      author: 'Olivia Kim',
      message: 'This was deprecated last quarter, good catch',
    },
  },
  {
    lineNumber: 6,
    metadata: {
      author: 'Raj Patel',
      message: 'We should add unit tests for this change',
    },
  },
  {
    lineNumber: 9,
    metadata: {
      author: 'Emma Thompson',
      message: 'Nice improvement! This should handle edge cases better',
    },
  },
  {
    lineNumber: 11,
    metadata: {
      author: 'David Johnson',
      message: 'This could break backward compatibility',
    },
  },
  {
    lineNumber: 13,
    metadata: {
      author: 'Sofia Martinez',
      message: 'Finally cleaning up legacy code!',
    },
  },
  {
    lineNumber: 15,
    metadata: {
      author: 'Alex Turner',
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
          metadata: {
            author: "Liam O'Brien",
            message: 'LGTM, ship it! 🚀',
          },
        },
      ],
    ],
  ];
