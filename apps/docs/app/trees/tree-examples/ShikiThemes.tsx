'use client';

import { resolveTheme } from '@pierre/diffs';
import {
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import { themeToTreeStyles } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  baseTreeOptions,
  DEFAULT_FILE_TREE_PANEL_CLASS,
  GIT_STATUSES_A,
} from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

type LightTheme = (typeof LIGHT_THEMES)[number];
type DarkTheme = (typeof DARK_THEMES)[number];

export function ShikiThemesSection() {
  const [selectedLightTheme, setSelectedLightTheme] =
    useState<LightTheme>('pierre-light');
  const [selectedDarkTheme, setSelectedDarkTheme] =
    useState<DarkTheme>('pierre-dark');
  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>(
    'system'
  );
  const [themeStyles, setThemeStyles] = useState<ReturnType<
    typeof themeToTreeStyles
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    setPrefersDark(m.matches);
    const listener = () => setPrefersDark(m.matches);
    m.addEventListener('change', listener);
    return () => m.removeEventListener('change', listener);
  }, []);

  const effectiveTheme =
    colorMode === 'dark'
      ? selectedDarkTheme
      : colorMode === 'light'
        ? selectedLightTheme
        : prefersDark
          ? selectedDarkTheme
          : selectedLightTheme;

  const loadTheme = useCallback(async (themeName: string) => {
    setError(null);
    try {
      const theme = await resolveTheme(
        themeName as Parameters<typeof resolveTheme>[0]
      );
      setThemeStyles(themeToTreeStyles(theme));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTheme(effectiveTheme);
  }, [effectiveTheme, loadTheme]);

  return (
    <TreeExampleSection id="shiki-themes">
      <FeatureHeader
        title="Style with Shiki themes"
        description={
          <>
            The same Shiki themes used by{' '}
            <Link href="../" className="inline-link">
              <code>@pierre/diffs</code>
            </Link>{' '}
            can style the <code>FileTree</code>. Sidebar and Git decoration
            colors come from your choice of themes. Pick a theme and switch
            light/dark to see the tree update live.
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
              {LIGHT_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => {
                    setSelectedLightTheme(theme);
                    setColorMode('light');
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
              {DARK_THEMES.map((theme) => (
                <DropdownMenuItem
                  key={theme}
                  onClick={() => {
                    setSelectedDarkTheme(theme);
                    setColorMode('dark');
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
          value={colorMode}
          onValueChange={(value) =>
            setColorMode(value as 'system' | 'light' | 'dark')
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

      <div>
        {loading && themeStyles == null && (
          <p className="text-muted-foreground py-4 text-sm">Loading theme…</p>
        )}
        {error && <p className="text-destructive py-4 text-sm">{error}</p>}
        {themeStyles != null && (
          <FileTree
            className={`${DEFAULT_FILE_TREE_PANEL_CLASS} min-h-[320px]`}
            options={{
              ...baseTreeOptions,
              id: 'shiki-themes-tree',
            }}
            gitStatus={GIT_STATUSES_A}
            initialExpandedItems={['src', 'src/components']}
            initialSelectedItems={['package.json']}
            style={themeStyles}
          />
        )}
      </div>
    </TreeExampleSection>
  );
}
