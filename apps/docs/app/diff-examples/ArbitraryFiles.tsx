'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import type { FileContents } from '@pierre/diff-ui';

import { FeatureHeader } from './FeatureHeader';

const OLD_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
};

export function ArbitraryFiles() {
  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Diff arbitrary files"
        description="In addition to rendering standard Git diffs and patches, you can pass any two files in Precision Diffs and get a diff between them. This is especially useful when comparing across generative snapshots where linear history isn't always available."
      />
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          detectLanguage: true,
          theme: 'pierre-dark',
          diffStyle: 'unified',
        }}
      />
    </div>
  );
}
