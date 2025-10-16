'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import {
  IconCheckLg,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCodeStyleInline,
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
import type { FileContents } from '@pierre/diff-ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { FeatureHeader } from './FeatureHeader';

const OLD_FILE: FileContents = {
  name: 'main.zig',
  contents: `const std = @import("std");
const allocator = std.heap.page_allocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello, {s}!\\n", .{"World"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
}
`,
};

const NEW_FILE: FileContents = {
  name: 'main.zig',
  contents: `const std = @import("std");
const GeneralPurposeAllocator = std.heap.GeneralPurposeAllocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    var gpa = GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello, {s}!\\n", .{"Zig"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
    try list.append(42);
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
        <div className="flex flex-col sm:flex-row flex-wrap md:items-center gap-3">
          <ButtonGroup
            value={diffIndicators}
            onValueChange={(value) =>
              setDiffStyle(value as 'bars' | 'classic' | 'none')
            }
          >
            {['bars', 'classic', 'none'].map((value) => (
              <ButtonGroupItem
                key={value}
                value={value}
                className="capitalize flex-1"
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
                  <ChevronDown className="text-muted-foreground ml-auto" />
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

          <div className="p-[2px] rounded-lg bg-secondary gridstack">
            <Button
              variant="outline"
              className="justify-between w-full md:w-auto gap-3 pl-3 pr-11"
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
              className="justify-self-end place-self-center mr-3 pointer-events-none"
            />
          </div>

          <div className="p-[2px] rounded-lg bg-secondary gridstack ">
            <Button
              variant="outline"
              className="justify-between w-full md:w-auto gap-3 pl-3 pr-11"
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
              className="justify-self-end place-self-center mr-3 pointer-events-none"
            />
          </div>
        </div>
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
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
