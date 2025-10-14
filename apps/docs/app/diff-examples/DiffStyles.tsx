'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import {
  IconAnnotate,
  IconBarChart,
  IconBarChart2,
  IconCheck,
  IconCheckLg,
  IconCodeBlock,
  IconCommentSuggest,
  IconEye,
  IconEyeSlash,
  IconMakeShorter,
  IconPaperclip,
  IconParagraph,
  IconParagraphPlus,
  IconPencil,
  IconPencilSquircle,
  IconSquircleLg,
  IconSquircleLgFill,
  IconSquircleSpeechText,
  IconSymbolAdded,
  IconSymbolDeleted,
  IconSymbolDiffstat,
  IconSymbolIgnored,
  IconSymbolMap,
  IconSymbolModified,
  IconSymbolMoved,
  IconSymbolPlaceholder,
  IconSymbolRef,
  IconSymbolResolved,
  IconWordWrap,
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
    description: 'Highlights entire words, uses enhanced algorithm',
  },
  {
    value: 'word',
    label: 'Word',
    description: 'Highlights changed words within lines',
  },
  {
    value: 'char',
    label: 'Character',
    description: 'Highlights individual character changes',
  },
  {
    value: 'none',
    label: 'None',
    description: 'Shows line-level changes only',
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
        <div className="flex flex-col md:flex-row gap-3">
          <ButtonGroup
            value={diffIndicators}
            onValueChange={(value) =>
              setDiffStyle(value as 'bars' | 'classic' | 'none')
            }
          >
            {['bars', 'classic', 'none'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {value === 'bars' ? (
                  <IconSymbolRef />
                ) : value === 'classic' ? (
                  <IconSymbolDiffstat />
                ) : (
                  <IconSymbolPlaceholder />
                )}
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
            {['enable', 'disable'].map((value) => (
              <ButtonGroupItem key={value} value={value}>
                {value === 'enable' ? (
                  <IconSquircleLgFill />
                ) : (
                  <IconSymbolPlaceholder />
                )}
                {value === 'disable' ? 'Disable BG' : 'Enable BG'}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="justify-start w-full md:w-auto"
              >
                <IconMakeShorter />
                {diffStyleOptions.find((opt) => opt.value === lineDiffStyle)
                  ?.label || lineDiffStyle}
                <ChevronDown className="ml-auto h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {diffStyleOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setLineDiffStyle(option.value)}
                  className="flex-col items-start py-2"
                >
                  <div className="flex w-full items-center">
                    <span className="font-medium">{option.label}</span>
                    {lineDiffStyle === option.value && (
                      <IconCheck className="ml-auto" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

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
