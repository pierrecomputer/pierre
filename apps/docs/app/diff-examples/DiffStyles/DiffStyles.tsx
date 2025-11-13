'use client';

import {
  IconCheckLg,
  IconChevronSm,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCodeStyleInline,
  IconListOrdered,
  IconParagraph,
  IconSymbolDiffstat,
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
import { Switch } from '@/components/ui/switch';
import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

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

interface DiffStylesProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}
export function DiffStyles({
  prerenderedDiff: { options, ...props },
}: DiffStylesProps) {
  const [diffIndicators, setDiffStyle] = useState<'classic' | 'bars' | 'none'>(
    'bars'
  );
  const [lineDiffStyle, setLineDiffStyle] = useState<
    'word-alt' | 'word' | 'char' | 'none'
  >('word-alt');
  const [disableBackground, setDisableBackground] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>(
    options?.overflow ?? 'wrap'
  );
  const [disableLineNumbers, setDisableLineNumbers] = useState(
    options?.disableLineNumbers ?? false
  );

  return (
    <div className="scroll-mt-[20px] space-y-5" id="styles">
      <div className="space-y-4">
        <FeatureHeader
          title="Choose how changes are styled"
          description="Your diffs, your choice. Render changed lines with classic diff indicators (+/–), full-width background colors, or vertical bars. You can even highlight inline changes—character or word based—and toggle line wrapping, hide numbers, and more."
        />
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center">
          <ButtonGroup
            value={diffIndicators}
            onValueChange={(value) =>
              setDiffStyle(value as 'bars' | 'classic' | 'none')
            }
            className="col-span-full"
          >
            {['bars', 'classic', 'none'].map((value) => (
              <ButtonGroupItem
                key={value}
                value={value}
                className="flex-1 capitalize"
              >
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

          <div className="bg-secondary rounded-lg p-[2px]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-start md:w-auto"
                >
                  <IconCodeStyleInline />
                  {}
                  {diffStyleOptions.find((opt) => opt.value === lineDiffStyle)
                    ?.label ?? lineDiffStyle}
                  <IconChevronSm className="text-muted-foreground ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-82">
                {diffStyleOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onClick={() => setLineDiffStyle(option.value)}
                    className="flex items-start gap-2 py-2"
                  >
                    {lineDiffStyle === option.value ? (
                      <IconCheckLg className="mt-[1px]" />
                    ) : (
                      <div className="h-4 w-4" />
                    )}
                    <div className="flex w-full flex-col items-start">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {option.description}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="bg-secondary gridstack rounded-lg p-[2px]">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setDisableBackground(!disableBackground)}
            >
              <div className="flex items-center gap-2">
                <IconCodeStyleBg />
                Backgrounds
              </div>
            </Button>
            <Switch
              checked={!disableBackground}
              onCheckedChange={(checked: boolean) =>
                setDisableBackground(!checked)
              }
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>

          <div className="bg-secondary gridstack rounded-lg p-[2px]">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() =>
                setOverflow(overflow === 'wrap' ? 'scroll' : 'wrap')
              }
            >
              <div className="flex items-center gap-2">
                <IconWordWrap />
                Wrapping
              </div>
            </Button>
            <Switch
              checked={overflow === 'wrap'}
              onCheckedChange={(checked: boolean) =>
                setOverflow(checked ? 'wrap' : 'scroll')
              }
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
          <div className="bg-secondary gridstack rounded-lg p-[2px]">
            <Button
              variant="outline"
              className="w-full justify-between gap-3 pr-11 pl-3 md:w-auto"
              onClick={() => setDisableLineNumbers(!disableLineNumbers)}
            >
              <div className="flex items-center gap-2">
                <IconListOrdered />
                Line Numbers
              </div>
            </Button>
            <Switch
              checked={!disableLineNumbers}
              onCheckedChange={(checked: boolean) =>
                setDisableLineNumbers(!checked)
              }
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
        </div>
      </div>
      <MultiFileDiff
        {...props}
        className="diff-container"
        options={{
          ...options,
          theme: 'pierre-dark',
          diffStyle: 'split',
          diffIndicators,
          disableBackground,
          overflow: overflow,
          lineDiffType: lineDiffStyle,
          disableLineNumbers,
        }}
      />
    </div>
  );
}
