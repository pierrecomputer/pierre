'use client';

import {
  IconCheck,
  IconChevronSm,
  IconFunction,
  IconType,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputWithIcon } from '@/components/ui/input-group';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

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

interface FontStylesProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function FontStyles({ prerenderedDiff }: FontStylesProps) {
  const [selectedFont, setSelectedFont] = useState('Berkeley Mono');
  const [selectedFontSize, setSelectedFontSize] = useState('14px');
  const [selectedLineHeight, setSelectedLineHeight] = useState('20px');
  const [fontFeatureSettings, setFontFeatureSettings] = useState('"aalt" 1');

  return (
    <div className="scroll-mt-[20px] space-y-5" id="fonts">
      <div className="space-y-4">
        <FeatureHeader
          title="Bring your own fonts"
          description={
            <>
              <code>@pierre/diffs</code> adapts to any <code>font</code>,{' '}
              <code>font-size</code>, <code>line-height</code>, and even{' '}
              <code>font-feature-settings</code> you may have set. Configure
              font options with your preferred CSS method globally or on a
              per-component basis.
            </>
          }
        />
        <div className="flex flex-col flex-wrap gap-3 sm:flex-row md:items-center">
          <div className="flex flex-wrap gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full min-w-[140px] flex-1 justify-start"
                >
                  <IconType className="h-4 w-4" />
                  {selectedFont}
                  <IconChevronSm className="text-muted-foreground ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-40">
                {Object.keys(fontMap).map((font) => (
                  <DropdownMenuItem
                    key={font}
                    onClick={() => {
                      setSelectedFont(font);
                      if (font === 'Berkeley Mono') {
                        setFontFeatureSettings('"aalt" 1');
                      } else {
                        setFontFeatureSettings('');
                      }
                    }}
                  >
                    {font}
                    {selectedFont === font && <IconCheck className="ml-auto" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-w-[80px]">
                  {selectedFontSize}
                  <IconChevronSm className="text-muted-foreground ml-auto" />
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-w-[80px]">
                  {selectedLineHeight}
                  <IconChevronSm className="text-muted-foreground ml-auto" />
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

          <InputWithIcon
            value={fontFeatureSettings}
            onChange={({ currentTarget }) =>
              setFontFeatureSettings(currentTarget.value)
            }
            icon={<IconFunction className="h-4 w-4" />}
            placeholder="Font feature settings"
            className="text-sm md:max-w-sm"
          />
        </div>
      </div>
      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        style={
          {
            '--diffs-font-family': `var(${fontMap[selectedFont]})`,
            '--diffs-font-size': selectedFontSize,
            '--diffs-line-height': selectedLineHeight,
            '--diffs-font-features': fontFeatureSettings,
          } as React.CSSProperties
        }
      />
    </div>
  );
}
