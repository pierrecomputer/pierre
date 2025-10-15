'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import {
  IconCheckLg,
  IconCheckboxFill,
  IconCodeStyleBars,
  IconCodeStyleInline,
  IconParagraph,
  IconSymbolDiffstat,
  IconSymbolPlaceholder,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileContents } from '@pierre/diff-ui';
import { ChevronDown } from 'lucide-react';
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

const diffStyleOptions = [
  {
    value: 'word-alt',
    label: 'Word-Alt',
    description: 'Highlight entire words with enhanced algorithm',
  },
  {
    value: 'word',
    label: 'Word',
    description: 'Highlight changed words within lines',
  },
  {
    value: 'char',
    label: 'Character',
    description: 'Highlight individual character changes',
  },
  {
    value: 'none',
    label: 'None',
    description: 'Show line-level changes only',
  },
] as const;

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
    <div className="space-y-5">
      <div className="space-y-4">
        <FeatureHeader
          title="Choose how changes are styled"
          description="Your diffs, your choice. Render changed lines with classic diff indicators (+/–), full-width background colors, or vertical bars. You can even highlight inline changes—character or word based—and toggle line wrapping, hide numbers, and more."
        />
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <ButtonGroup
            value={diffIndicators}
            onValueChange={(value) =>
              setDiffStyle(value as 'bars' | 'classic' | 'none')
            }
          >
            {['bars', 'classic', 'none'].map((value) => (
              <ButtonGroupItem key={value} value={value} className="capitalize">
                {value === 'bars' ? (
                  <IconCodeStyleBars />
                ) : value === 'classic' ? (
                  <IconSymbolDiffstat />
                ) : (
                  <IconParagraph />
                )}
                {value}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>

          <div className="p-[2px] rounded-lg bg-secondary">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-start w-full md:w-auto"
                >
                  <IconCodeStyleInline />
                  {}
                  {diffStyleOptions.find((opt) => opt.value === lineDiffStyle)
                    ?.label ?? lineDiffStyle}
                  <ChevronDown className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-82">
                {diffStyleOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => setLineDiffStyle(option.value)}
                    className="flex items-start py-2 gap-2"
                  >
                    {lineDiffStyle === option.value ? (
                      <IconCheckLg className="mt-[1px]" />
                    ) : (
                      <div className="w-4 h-4" />
                    )}
                    <div className="flex flex-col w-full items-start">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

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
            {['enable', 'disable'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {(value === 'enable' && !disableBackground) ||
                (value === 'disable' && disableBackground) ? (
                  <IconCheckboxFill />
                ) : (
                  <IconSymbolPlaceholder />
                )}
                {value === 'disable' ? 'Off' : 'Background colors'}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>

          <ButtonGroup
            value={overflow}
            onValueChange={(value) => setOverflow(value as 'wrap' | 'scroll')}
          >
            <ButtonGroupItem value="wrap">
              {overflow === 'wrap' ? (
                <IconCheckboxFill />
              ) : (
                <IconSymbolPlaceholder />
              )}
              Word wrap
            </ButtonGroupItem>
            <ButtonGroupItem value="scroll">
              {overflow === 'scroll' ? (
                <IconCheckboxFill />
              ) : (
                <IconSymbolPlaceholder />
              )}
              Off
            </ButtonGroupItem>
          </ButtonGroup>
        </div>
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          detectLanguage: true,
          theme: 'pierre-dark',
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
