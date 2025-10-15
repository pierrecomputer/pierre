'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconDiffBlended, IconDiffSplit } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { FileContents } from '@pierre/diff-ui';
import { useState } from 'react';

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

export function SplitUnified() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Diff layout styles"
        description="Choose from stacked (unified) or split (side-by-side). Both use CSS Grid under the hood, meaning fewer DOM nodes and faster rendering."
      />
      <ButtonGroup
        value={diffStyle}
        onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
      >
        <ButtonGroupItem value="split">
          <IconDiffSplit />
          Split
        </ButtonGroupItem>
        <ButtonGroupItem value="unified">
          <IconDiffBlended />
          Stacked
        </ButtonGroupItem>
      </ButtonGroup>

      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          detectLanguage: true,
          theme: 'pierre-dark',
          diffStyle,
        }}
      />
    </div>
  );
}
