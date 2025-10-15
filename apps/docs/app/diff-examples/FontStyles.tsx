'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconCheck, IconFunction, IconType } from '@/components/icons';
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

const fontMap: Record<string, string> = {
  'Berkeley Mono': '--font-berkeley-mono',
  'Geist Mono': '--font-geist-mono',
  'Fira Code': '--font-fira-mono',
  'IBM Plex Mono': '--font-ibm-plex-mono',
  'JetBrains Mono': '--font-jetbrains-mono',
  'Cascadia Code': '--font-cascadia-code',
};

const fontSizes = ['10px', '12px', '13px', '14px', '18px'];
const lineHeights = ['16px', '20px', '24px', '28px'];

export function FontStyles() {
  const [selectedFont, setSelectedFont] = useState('Berkeley Mono');
  const [selectedFontSize, setSelectedFontSize] = useState('14px');
  const [selectedLineHeight, setSelectedLineHeight] = useState('20px');

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <FeatureHeader
          title="Bring your own fonts"
          description="Precision Diffs is adaptable to any font, font-size, line-height, and even font-feature-settings you may have set. Configure font options with your preferred CSS method globally or on a per-component basis."
        />
        <div className="flex flex-col sm:flex-row flex-wrap md:items-center gap-3">
          <div className="flex flex-wrap gap-3">
            <div className="p-[2px] rounded-lg bg-secondary flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="justify-start min-w-[140px] w-full"
                  >
                    <IconType className="h-4 w-4" />
                    {selectedFont}
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  {Object.keys(fontMap).map((font) => (
                    <DropdownMenuItem
                      key={font}
                      onClick={() => setSelectedFont(font)}
                    >
                      {font}
                      {selectedFont === font && (
                        <IconCheck className="ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="p-[2px] rounded-lg bg-secondary">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-w-[80px]">
                    {selectedFontSize}
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {fontSizes.map((size) => (
                    <DropdownMenuItem
                      key={size}
                      onClick={() => setSelectedFontSize(size)}
                    >
                      {size}
                      {selectedFontSize === size && (
                        <IconCheck className="ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="p-[2px] rounded-lg bg-secondary">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-w-[80px]">
                    {selectedLineHeight}
                    <ChevronDown className="h-4 w-4 ml-auto" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {lineHeights.map((height) => (
                    <DropdownMenuItem
                      key={height}
                      onClick={() => setSelectedLineHeight(height)}
                    >
                      {height}
                      {selectedLineHeight === height && (
                        <IconCheck className="ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="p-[2px] rounded-lg bg-secondary">
            <InputWithIcon
              icon={<IconFunction className="h-4 w-4" />}
              placeholder="Font feature settings"
              className="md:max-w-xs"
            />
          </div>
        </div>
      </div>
      <div
        style={
          {
            '--pjs-font-family': `var(${fontMap[selectedFont]})`,
            '--pjs-font-size': selectedFontSize,
            '--pjs-line-height': selectedLineHeight,
          } as React.CSSProperties
        }
      >
        <FileDiff
          oldFile={OLD_FILE}
          newFile={NEW_FILE}
          className="rounded-lg overflow-hidden border"
          options={{
            detectLanguage: true,
            theme: 'pierre-dark',
            diffStyle: 'unified',
          }}
        />
      </div>
    </div>
  );
}
