'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconParagraph, IconWordWrap } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
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

export function DiffStyles() {
  const [diffIndicators, setDiffStyle] = useState<'classic' | 'bars' | 'none'>(
    'bars'
  );
  const [lineDiffStyle, setLineDiffStyle] = useState<
    'word-alt' | 'word' | 'char' | 'none'
  >('word-alt');
  const [disableBackground, setDisableBackground] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('wrap');

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <h3 className="text-2xl font-semibold">
          Choose how changes are styled
        </h3>
        <p className="text-sm text-muted-foreground">
          Your diffs, your choice. Render changed lines with classic diff
          indicators (+/–), full-width background colors, or vertical bars. You
          can even highlight inline changes—character or word based—and toggle
          line wrapping, hide numbers, and more.
        </p>
        <div className="flex flex-col md:flex-row gap-3">
          <ButtonGroup
            value={diffIndicators}
            onValueChange={(value) =>
              setDiffStyle(value as 'bars' | 'classic' | 'none')
            }
          >
            {['bars', 'classic', 'none'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {value}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
          <ButtonGroup
            value={disableBackground ? 'disable' : 'enable'}
            onValueChange={(value) => {
              if (value === 'disable') {
                setDisableBackground(true);
              } else {
                setDisableBackground(false);
              }
            }}
          >
            {['disable', 'enable'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {value === 'disable' ? 'Disable BG' : 'Enable BG'}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
          <ButtonGroup
            value={lineDiffStyle}
            onValueChange={(value) =>
              setLineDiffStyle(value as 'word-alt' | 'word' | 'char' | 'none')
            }
          >
            {['word', 'word-alt', 'char', 'none'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {value}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>

          <ButtonGroup
            value={overflow}
            onValueChange={(value) => setOverflow(value as 'wrap' | 'scroll')}
          >
            <ButtonGroupItem value="wrap">
              <IconWordWrap />
              Wrap
            </ButtonGroupItem>
            <ButtonGroupItem value="scroll">
              <IconParagraph />
              No wrap
            </ButtonGroupItem>
          </ButtonGroup>
        </div>
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        options={{
          detectLanguage: true,
          theme: 'github-dark',
          diffStyle: 'unified',
          diffIndicators,
          disableBackground,
          overflow: overflow,
          lineDiffType: lineDiffStyle,
        }}
      />
    </div>
  );
}
