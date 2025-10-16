'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import {
  IconCheck,
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
import { type FileContents, preloadHighlighter } from '@pierre/diff-ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

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

export function ShikiThemes() {
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

  const [selectedLightTheme, setSelectedLightTheme] =
    useState<(typeof LIGHT_THEMES)[number]>('pierre-light');
  const [selectedDarkTheme, setSelectedDarkTheme] =
    useState<(typeof DARK_THEMES)[number]>('pierre-dark');
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >('system');

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Adapts to any Shiki theme"
        description="Precision Diffs are built with Shiki for syntax highlighting and general theming. Our components automatically adapt to blend in with your theme selection, including across color modes."
      />
      <div className="flex flex-col sm:flex-row flex-wrap md:items-center gap-3">
        <div className="p-[2px] rounded-lg bg-secondary">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="justify-start w-full md:w-auto"
              >
                <IconColorLight />
                {selectedLightTheme}
                <ChevronDown className="ml-auto h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {LIGHT_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => setSelectedLightTheme(theme)}
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
        </div>

        <div className="p-[2px] rounded-lg bg-secondary">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="justify-start w-full md:w-auto"
              >
                <IconColorDark />
                {selectedDarkTheme}
                <ChevronDown className="ml-auto h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="overflow-auto max-h-[550px]"
            >
              {DARK_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => setSelectedDarkTheme(theme)}
                  className={
                    selectedDarkTheme === theme ? 'bg-accent' : undefined
                  }
                >
                  {theme}
                  {selectedDarkTheme === theme && (
                    <IconCheck className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ButtonGroup
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
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          diffStyle: 'split',
          themeMode: selectedColorMode,
          themes: {
            dark: selectedDarkTheme,
            light: selectedLightTheme,
          },
        }}
      />
    </div>
  );
}
