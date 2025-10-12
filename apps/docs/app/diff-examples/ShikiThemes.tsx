'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import {
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
import {
  type FileContents,
  type ThemesType,
  preloadHighlighter,
} from '@pierre/diff-ui';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';

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
    useState<ThemesType['light']>('github-light');
  const [selectedDarkTheme, setSelectedDarkTheme] =
    useState<ThemesType['dark']>('github-dark');
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >('system');

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold">Adapts to any Shiki theme</h3>
      <p className="text-sm text-muted-foreground">
        Precision Diffs are built with Shiki for syntax highlighting and general
        theming. Our components automatically adapt to blend in with your theme
        selection, including across color modes.
      </p>
      <div className="flex flex-col md:flex-row gap-3">
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
            {[
              'solarized-light',
              'catppuccin-latte',
              'github-light',
              'gruvbox-light-hard',
              'vitesse-light',
            ].map((theme) => (
              <DropdownMenuItem
                key={theme}
                onClick={() =>
                  setSelectedLightTheme(theme as ThemesType['light'])
                }
              >
                {theme}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
          <DropdownMenuContent align="start">
            {[
              'ayu-dark',
              'catppuccin-mocha',
              'dark-plus',
              'github-dark',
              'vitesse-dark',
            ].map((theme) => (
              <DropdownMenuItem
                key={theme}
                onClick={() =>
                  setSelectedDarkTheme(theme as ThemesType['dark'])
                }
              >
                {theme}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ButtonGroup
          value={selectedColorMode}
          onValueChange={(value) =>
            setSelectedColorMode(value as 'system' | 'light' | 'dark')
          }
        >
          <ButtonGroupItem value="system">
            <IconColorAuto />
            Auto
          </ButtonGroupItem>
          <ButtonGroupItem value="light">
            <IconColorLight />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="dark">
            <IconColorDark />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        options={{
          detectLanguage: true,
          diffStyle: 'unified',
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
