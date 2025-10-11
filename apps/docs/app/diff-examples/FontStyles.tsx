'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconFunction, IconType } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputWithIcon } from '@/components/ui/input-group';
import type { FileContents } from '@pierre/diff-ui';
import { ChevronDown } from 'lucide-react';
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

export function FontStyles() {
  const [selectedFont, setSelectedFont] = useState('Geist Mono');
  const [selectedFontSize, setSelectedFontSize] = useState('14px');
  const [selectedLineHeight, setSelectedLineHeight] = useState('20px');

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <h3 className="text-2xl font-semibold">Bring your own fonts</h3>
        <p className="text-sm text-muted-foreground">
          Precision Diffs is adaptable to any font, font-size, line-height, and
          even font-feature-settings you may have set. Configure font options
          with your preferred CSS method globally or on a per-component basis.
        </p>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-start min-w-[140px]"
                >
                  <IconType className="h-4 w-4" />
                  {selectedFont}
                  <ChevronDown className="h-4 w-4 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setSelectedFont('Geist Mono')}>
                  Geist Mono
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFont('SF Mono')}>
                  SF Mono
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFont('cursive')}>
                  Cursive
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFont('fantasy')}>
                  Fantasy
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFont('monospace')}>
                  Monospace
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-w-[80px]">
                  {selectedFontSize}
                  <ChevronDown className="h-4 w-4 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setSelectedFontSize('10px')}>
                  10px
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFontSize('12px')}>
                  12px
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFontSize('14px')}>
                  14px
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedFontSize('18px')}>
                  18px
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-w-[80px]">
                  {selectedLineHeight}
                  <ChevronDown className="h-4 w-4 ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setSelectedLineHeight('16px')}>
                  16px
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLineHeight('20px')}>
                  20px
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLineHeight('24px')}>
                  24px
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLineHeight('28px')}>
                  28px
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <InputWithIcon
            icon={<IconFunction className="h-4 w-4" />}
            placeholder="Font feature settings"
            className="max-w-xs"
          />
        </div>
      </div>
      <div
        style={{
          '--pjs-font-family': selectedFont,
          '--pjs-font-size': selectedFontSize,
          '--pjs-line-height': selectedLineHeight,
        }}
      >
        <FileDiff
          oldFile={OLD_FILE}
          newFile={NEW_FILE}
          options={{
            detectLanguage: true,
            theme: 'github-dark',
            diffStyle: 'unified',
          }}
        />
      </div>
    </div>
  );
}
