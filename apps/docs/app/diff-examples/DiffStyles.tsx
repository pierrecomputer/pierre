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
  const [_backgroundStyle, _setBackgroundStyle] = useState<
    'classic' | 'background' | 'bar'
  >('classic');
  const [lineDiffStyle, setLineDiffStyle] = useState<
    'word-alt' | 'word' | 'char' | 'none'
  >('word');
  const [wrapMode, setWrapMode] = useState<'wrap' | 'scroll'>('wrap');

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
          <ButtonGroup value={'classic'}>
            {['background', 'classic', 'bar', 'none'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {value}
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
            value={wrapMode}
            onValueChange={(value) => setWrapMode(value as 'wrap' | 'scroll')}
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
          overflow: wrapMode,
          lineDiffType: lineDiffStyle,
        }}
      />
    </div>
  );
}
