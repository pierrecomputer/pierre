'use client';

import Button from '@/components/Button';
import ButtonGroup from '@/components/ButtonGroup';
import styles from '@/components/Layout.module.css';
import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconDiffBlended, IconDiffSplit } from '@/components/icons';
import type { FileContents } from '@pierre/diff-ui';
import { useState } from 'react';

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
    <>
      <h3>Diff styles</h3>
      <p className={styles.fsSm}>
        Choose from stacked (unified) or split (side-by-side). Both use CSS Grid
        under the hood, meaning fewer DOM nodes and fast rendering.
      </p>
      <ButtonGroup>
        <Button
          variant={diffStyle === 'split' ? 'active' : undefined}
          onClick={() => setDiffStyle('split')}
        >
          <IconDiffSplit />
          Split
        </Button>
        <Button
          variant={diffStyle === 'unified' ? 'active' : undefined}
          onClick={() => setDiffStyle('unified')}
        >
          <IconDiffBlended />
          Stacked
        </Button>
      </ButtonGroup>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        options={{
          detectLanguage: true,
          theme: 'catppuccin-frappe',
          diffStyle,
        }}
      />
    </>
  );
}
