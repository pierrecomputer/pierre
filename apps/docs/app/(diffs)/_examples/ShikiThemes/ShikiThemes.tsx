'use client';

import { preloadHighlighter } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import {
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import { useEffect, useState } from 'react';

import { FeatureHeader } from '@/components/FeatureHeader';
import { PierreThemeFootnote } from '@/components/footnotes/PierreThemeFootnote';
import { docsThemeCatalog } from '@/components/themeCatalog';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type LightThemeName = string;
type DarkThemeName = string;

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
  const [selectedLightTheme, setSelectedLightTheme] = useState<LightThemeName>(
    (themeObj?.light as 'pierre-light') ?? 'pierre-light'
  );
  const [selectedDarkTheme, setSelectedDarkTheme] = useState<DarkThemeName>(
    (themeObj?.dark as 'pierre-dark') ?? 'pierre-dark'
  );
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >('system');

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="themes"
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
            <DropdownMenuContent align="start" scrollSelectedIntoView>
              {docsThemeCatalog
                .getThemeNames({ colorScheme: 'light' })
                .map((theme) => (
                  <DropdownMenuItem
                    key={theme}
                    onClick={() => {
                      setSelectedLightTheme(theme);
                      setSelectedColorMode('light');
                    }}
                    selected={selectedLightTheme === theme}
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
              scrollSelectedIntoView
            >
              {docsThemeCatalog
                .getThemeNames({ colorScheme: 'dark' })
                .map((theme) => (
                  <DropdownMenuItem
                    key={theme}
                    onClick={() => {
                      setSelectedDarkTheme(theme);
                      setSelectedColorMode('dark');
                    }}
                    selected={selectedDarkTheme === theme}
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
          ...options,
          theme: { dark: selectedDarkTheme, light: selectedLightTheme },
          themeType: selectedColorMode,
        }}
        // WorkerPool is disabled because we need to be able to change themes
        // without changing our whole page
        disableWorkerPool
      />
      <PierreThemeFootnote />
    </div>
  );
}
