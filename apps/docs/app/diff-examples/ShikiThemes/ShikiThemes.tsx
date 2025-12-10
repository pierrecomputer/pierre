'use client';

import {
  IconArrowDownRight,
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { preloadHighlighter } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

const LIGHT_THEMES = [
  'pierre-light',
  'catppuccin-latte',
  'everforest-light',
  'github-light',
  'github-light-default',
  'github-light-high-contrast',
  'gruvbox-light-hard',
  'gruvbox-light-medium',
  'gruvbox-light-soft',
  'kanagawa-lotus',
  'light-plus',
  'material-theme-lighter',
  'min-light',
  'one-light',
  'rose-pine-dawn',
  'slack-ochin',
  'snazzy-light',
  'solarized-light',
  'vitesse-light',
] as const;

const DARK_THEMES = [
  'pierre-dark',
  'andromeeda',
  'aurora-x',
  'ayu-dark',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',
  'dark-plus',
  'dracula',
  'dracula-soft',
  'everforest-dark',
  'github-dark',
  'github-dark-default',
  'github-dark-dimmed',
  'github-dark-high-contrast',
  'gruvbox-dark-hard',
  'gruvbox-dark-medium',
  'gruvbox-dark-soft',
  'houston',
  'kanagawa-dragon',
  'kanagawa-wave',
  'laserwave',
  'material-theme',
  'material-theme-darker',
  'material-theme-ocean',
  'material-theme-palenight',
  'min-dark',
  'monokai',
  'night-owl',
  'nord',
  'one-dark-pro',
  'plastic',
  'poimandres',
  'red',
  'rose-pine',
  'rose-pine-moon',
  'slack-dark',
  'solarized-dark',
  'synthwave-84',
  'tokyo-night',
  'vesper',
  'vitesse-black',
  'vitesse-dark',
] as const;

interface ShikiThemesProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function ShikiThemes({
  prerenderedDiff: { options, ...props },
}: ShikiThemesProps) {
  useEffect(() => {
    void preloadHighlighter({
      themes: [
        'ayu-dark',
        'catppuccin-mocha',
        'dark-plus',
        'github-dark',
        'vitesse-dark',
      ],
      langs: [],
    });
  }, []);

  const themeObj = typeof options?.theme === 'object' ? options.theme : null;
  const [selectedLightTheme, setSelectedLightTheme] = useState<
    (typeof LIGHT_THEMES)[number]
  >((themeObj?.light as 'pierre-light') ?? 'pierre-light');
  const [selectedDarkTheme, setSelectedDarkTheme] = useState<
    (typeof DARK_THEMES)[number]
  >((themeObj?.dark as 'pierre-dark') ?? 'pierre-dark');
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >('system');

  return (
    <div className="scroll-mt-[20px] space-y-5" id="themes">
      <FeatureHeader
        title="Adapts to any Shiki theme"
        description={
          <>
            We built <code>@pierre/diffs</code> on top of Shiki for syntax
            highlighting and general theming. Our components automatically adapt
            to blend in with your theme selection, including across color modes.
          </>
        }
      />
      <div className="flex flex-wrap gap-3 md:items-center">
        <div className="flex w-full gap-3 md:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start">
                <IconColorLight />
                {selectedLightTheme}
                <IconChevronSm className="text-muted-foreground ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {LIGHT_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => {
                    setSelectedLightTheme(theme);
                    setSelectedColorMode('light');
                  }}
                  className={
                    selectedLightTheme === theme ? 'bg-accent' : undefined
                  }
                >
                  {theme}
                  {selectedLightTheme === theme && (
                    <IconCheck className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start">
                <IconColorDark />
                {selectedDarkTheme}
                <IconChevronSm className="text-muted-foreground ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[550px] overflow-auto"
            >
              {DARK_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => {
                    setSelectedDarkTheme(theme);
                    setSelectedColorMode('dark');
                  }}
                  className={
                    selectedDarkTheme === theme ? 'bg-accent' : undefined
                  }
                >
                  {theme}
                  {selectedDarkTheme === theme ? (
                    <IconCheck className="ml-auto" />
                  ) : (
                    <div className="ml-2 h-4 w-4" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ButtonGroup
          className="w-full md:w-auto"
          value={selectedColorMode}
          onValueChange={(value) =>
            setSelectedColorMode(value as 'system' | 'light' | 'dark')
          }
        >
          <ButtonGroupItem value="system" className="flex-1">
            <IconColorAuto />
            Auto
          </ButtonGroupItem>
          <ButtonGroupItem value="light" className="flex-1">
            <IconColorLight />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="dark" className="flex-1">
            <IconColorDark />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>
      </div>
      <MultiFileDiff
        {...props}
        className="overflow-hidden rounded-lg border dark:border-neutral-800"
        options={{
          diffStyle: 'split',
          themeType: selectedColorMode,
          theme: { dark: selectedDarkTheme, light: selectedLightTheme },
        }}
      />
      <div className="flex gap-1">
        <IconArrowDownRight className="text-muted-foreground my-[2px] opacity-50" />
        <p className="text-muted-foreground text-sm">
          Love the Pierre themes?{' '}
          <Link
            href="https://marketplace.visualstudio.com/items?itemName=pierre-computer-co.pierre-vscode-theme"
            target="_blank"
            className="text-foreground hover:text-foreground decoration-muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-3 transition-colors"
          >
            Install our Pierre VS Code Theme pack
          </Link>{' '}
          with light and dark flavors.
        </p>
      </div>
    </div>
  );
}
