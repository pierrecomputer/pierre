import type {
  DiffLineAnnotation,
  FileStreamOptions,
  LineAnnotation,
} from '@pierre/precision-diffs';

import { createHighlighterCleanup } from './createHighlighterCleanup';

const ASSET_BASE_PATH = '/demo-assets';

export const DEMO_ASSET_PATHS = {
  diff: `${ASSET_BASE_PATH}/diff.patch`,
  exampleMarkdown: `${ASSET_BASE_PATH}/example_md.txt`,
  exampleTypescript: `${ASSET_BASE_PATH}/example_ts.txt`,
  fileNew: `${ASSET_BASE_PATH}/fileNew.txt`,
  fileOld: `${ASSET_BASE_PATH}/fileOld.txt`,
} as const;

export interface CodeStreamConfig {
  assetPath: string;
  letterByLetter: boolean;
  options: FileStreamOptions;
}

export const CODE_STREAM_CONFIGS: readonly CodeStreamConfig[] = [
  {
    assetPath: DEMO_ASSET_PATHS.exampleTypescript,
    letterByLetter: false,
    options: {
      lang: 'tsx',
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      ...createHighlighterCleanup(),
    },
  },
  {
    assetPath: DEMO_ASSET_PATHS.exampleMarkdown,
    letterByLetter: true,
    options: {
      lang: 'markdown',
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      ...createHighlighterCleanup(),
    },
  },
] as const;

export const DEFAULT_FILES = {
  old: {
    name: 'file_old.ts',
    assetPath: DEMO_ASSET_PATHS.fileOld,
  },
  new: {
    name: 'file_new.ts',
    assetPath: DEMO_ASSET_PATHS.fileNew,
  },
} as const;

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
          metadata: { author: "Liam O'Brien", message: 'LGTM, ship it! 🚀' },
        },
      ],
    ],
  ];
