import type { DiffLineAnnotation, FileContents } from '@pierre/precision-diffs';
import type { PreloadMultiFileDiffOptions } from '@pierre/precision-diffs/ssr';

export interface AnnotationMetadata {
  key: string;
  isThread: boolean;
}

export const ANNOTATION_EXAMPLE: PreloadMultiFileDiffOptions<AnnotationMetadata> =
  {
    oldFile: {
      name: 'file.tsx',
      contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <h1>
        Code Storage is a fully managed version control system built to meet the highest standards of speed, scale, and reliability.
      </h1>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
    },
    newFile: {
      name: 'file.tsx',
      contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <h1>
        Code Storage is a fully managed version control system built to meet the highest standards of speed, scale, and reliability.
      </h1>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
    },
    options: {
      theme: 'pierre-dark',
      diffStyle: 'unified',
    },
    annotations: [
      {
        side: 'additions',
        lineNumber: 12,
        metadata: {
          key: 'additions-8',
          isThread: true,
        },
      },
    ],
  };

export interface AcceptRejectMetadata {
  key: string;
  accepted?: boolean;
}

export const ACCEPT_REJECT_OLD_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      {/* todo: add header and icon sprite */}
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
      </ul>
    </div>
  );
}
`,
};

export const ACCEPT_REJECT_NEW_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
      </ul>
    </div>
  );
}
`,
};

export const ACCEPT_REJECT_ANNOTATIONS: DiffLineAnnotation<AcceptRejectMetadata>[] =
  [{ side: 'additions', lineNumber: 9, metadata: { key: 'del-1' } }];

export const ACCEPT_REJECT_EXAMPLE: PreloadMultiFileDiffOptions<AcceptRejectMetadata> =
  {
    oldFile: ACCEPT_REJECT_OLD_FILE,
    newFile: ACCEPT_REJECT_NEW_FILE,
    options: {
      theme: 'pierre-dark',
      diffStyle: 'unified',
      expandUnchanged: true,
    },
    annotations: ACCEPT_REJECT_ANNOTATIONS,
  };
