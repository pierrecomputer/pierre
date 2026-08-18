'use client';

import type { DiffIndicators } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import {
  IconCheck,
  IconChevronSm,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCodeStyleInline,
  IconListOrdered,
  IconParagraph,
  IconSymbolDiffstat,
  IconWordWrap,
} from '@pierre/icons';
import { useState } from 'react';

import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleSwitch } from '@/components/ui/toggle-switch';

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
  const [diffIndicators, setDiffStyle] = useState<DiffIndicators>('bars');
  const [lineDiffType, setLineDiffType] = useState<
    'word-alt' | 'word' | 'char' | 'none'
  >('word-alt');
  const [disableBackground, setDisableBackground] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>(
    options?.overflow ?? 'wrap'
  );
  const [disableLineNumbers, setDisableLineNumbers] = useState<boolean>(
    options?.disableLineNumbers === true
  );

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <FeatureHeader
          id="styles"
          title="Choose how changes are styled"
          description="Your diffs, your choice. Render changed lines with classic diff indicators (+/–), full-width background colors, or vertical bars. You can even highlight inline changes—character or word based—and toggle line wrapping, hide numbers, and more."
        />
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-center">
          <ButtonGroup
            value={diffIndicators}
            onValueChange={(value) => setDiffStyle(value as DiffIndicators)}
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-start md:w-auto"
              >
                <IconCodeStyleInline />
                {}
                {diffStyleOptions.find((opt) => opt.value === lineDiffType)
                  ?.label ?? lineDiffType}
                <IconChevronSm className="text-muted-foreground ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-82"
              scrollSelectedIntoView
            >
              {diffStyleOptions.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => setLineDiffType(option.value)}
                  selected={lineDiffType === option.value}
                  className="flex items-start gap-2 py-2"
                >
                  {lineDiffType === option.value ? (
                    <IconCheck className="mt-[1px]" />
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

          <ToggleSwitch
            icon={<IconCodeStyleBg />}
            label="Backgrounds"
            checked={!disableBackground}
            onCheckedChange={(checked) => setDisableBackground(!checked)}
            className="w-full md:w-auto"
          />

          <ToggleSwitch
            icon={<IconWordWrap />}
            label="Wrapping"
            checked={overflow === 'wrap'}
            onCheckedChange={(checked) =>
              setOverflow(checked ? 'wrap' : 'scroll')
            }
            className="w-full md:w-auto"
          />

          <ToggleSwitch
            icon={<IconListOrdered />}
            label="Line Numbers"
            checked={!disableLineNumbers}
            onCheckedChange={(checked) => setDisableLineNumbers(!checked)}
            className="w-full md:w-auto"
          />
        </div>
      </div>
      <MultiFileDiff
        {...props}
        className="diff-container"
        options={{
          ...options,
          diffIndicators,
          disableBackground,
          overflow,
          lineDiffType,
          disableLineNumbers,
        }}
        // Because we need to change lineDiffType, we can't use the WorkerPool
        disableWorkerPool
      />
    </div>
  );
}
