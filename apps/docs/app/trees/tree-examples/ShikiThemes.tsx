'use client';

import { resolveTheme } from '@pierre/diffs';
import {
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import { useCallback, useEffect, useState } from 'react';
import type { ThemeRegistrationResolved } from 'shiki';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { baseTreeOptions } from './demo-data';
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

/**
 * Map Shiki theme colors to CSS. Sets --ft-theme-* variables so the trees
 * stylesheet fallback chain (--ft-* → --ft-theme-* → default) consumes them.
 */
function shikiThemeToTreeStyles(
  theme: ThemeRegistrationResolved
): React.CSSProperties {
  const c = theme.colors ?? {};
  const sideBarBg =
    c['sideBar.background'] ?? c['editor.background'] ?? theme.bg;
  const sideBarFg =
    c['sideBar.foreground'] ?? c['editor.foreground'] ?? theme.fg;
  const sideBarBorder = c['sideBar.border'] ?? c['editor.background'];
  const listSelectionBg =
    c['list.activeSelectionBackground'] ?? c['editor.selectionBackground'];
  const listHoverBg = c['list.hoverBackground'];
  const focusOutline = c['list.focusOutline'] ?? c['focusBorder'];
  const inputBg = c['input.background'] ?? sideBarBg;
  const inputBorder = c['input.border'] ?? sideBarBorder;
  const sectionHeaderFg = c['sideBarSectionHeader.foreground'] ?? sideBarFg;
  const gitAdded =
    c['gitDecoration.addedResourceForeground'] ?? c['terminal.ansiGreen'];
  const gitModified =
    c['gitDecoration.modifiedResourceForeground'] ?? c['terminal.ansiBlue'];
  const gitDeleted =
    c['gitDecoration.deletedResourceForeground'] ?? c['terminal.ansiRed'];

  return {
    colorScheme: theme.type === 'dark' ? 'dark' : 'light',
    backgroundColor: sideBarBg,
    color: sideBarFg,
    borderColor: sideBarBorder,
    /* Theme token vars (kebab-case): style.css uses these in fallback chains. */
    ['--ft-theme-side-bar-background' as string]: sideBarBg,
    ['--ft-theme-side-bar-foreground' as string]: sideBarFg,
    ['--ft-theme-side-bar-border' as string]: sideBarBorder ?? sideBarBg,
    ['--ft-theme-side-bar-section-header-foreground' as string]:
      sectionHeaderFg,
    ['--ft-theme-list-hover-background' as string]:
      listHoverBg ??
      (theme.type === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
    ['--ft-theme-list-active-selection-background' as string]:
      listSelectionBg ?? 'transparent',
    ['--ft-theme-list-focus-outline' as string]: focusOutline ?? sideBarFg,
    ['--ft-theme-input-background' as string]: inputBg,
    ['--ft-theme-input-border' as string]: inputBorder ?? sideBarBorder,
    ...(gitAdded != null && gitAdded !== ''
      ? {
          ['--ft-theme-git-decoration-added-resource-foreground' as string]:
            gitAdded,
        }
      : {}),
    ...(gitModified != null && gitModified !== ''
      ? {
          ['--ft-theme-git-decoration-modified-resource-foreground' as string]:
            gitModified,
        }
      : {}),
    ...(gitDeleted != null && gitDeleted !== ''
      ? {
          ['--ft-theme-git-decoration-deleted-resource-foreground' as string]:
            gitDeleted,
        }
      : {}),
  };
}

export function ShikiThemesSection() {
  const [selectedLightTheme, setSelectedLightTheme] =
    useState<LightTheme>('pierre-light');
  const [selectedDarkTheme, setSelectedDarkTheme] =
    useState<DarkTheme>('pierre-dark');
  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>(
    'system'
  );
  const [themeStyles, setThemeStyles] = useState<React.CSSProperties | null>(
    null
  );
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
    setLoading(true);
    setError(null);
    try {
      const theme = await resolveTheme(
        themeName as Parameters<typeof resolveTheme>[0]
      );
      setThemeStyles(shikiThemeToTreeStyles(theme));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setThemeStyles(null);
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
        title="Shiki themes on the tree"
        description={
          <>
            The same Shiki themes used by <code>@pierre/diffs</code> can drive
            the FileTree: sidebar background/foreground, borders, selection,
            focus ring, and git status colors come from the theme&apos;s{' '}
            <code>colors</code> (e.g. <code>sideBar.background</code>,{' '}
            <code>sideBar.foreground</code>,{' '}
            <code>list.activeSelectionBackground</code>,{' '}
            <code>gitDecoration.*</code>). Pick a theme and switch light/dark to
            see the tree update live.
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
                    setColorMode('light');
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
                    setColorMode('dark');
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

      <div
        className="min-h-[320px] overflow-auto rounded-lg border p-3"
        style={
          themeStyles ?? {
            backgroundColor: 'var(--muted)',
            color: 'var(--muted-foreground)',
          }
        }
      >
        {loading && (
          <p className="text-muted-foreground py-4 text-sm">Loading theme…</p>
        )}
        {error && <p className="text-destructive py-4 text-sm">{error}</p>}
        {!loading && !error && themeStyles != null ? (
          <FileTree
            options={{
              ...baseTreeOptions,
              id: 'shiki-themes-tree',
              config: {
                ...baseTreeOptions.config,
                initialState: {
                  ...baseTreeOptions.config?.initialState,
                  selectedItems: ['package.json'],
                },
              },
            }}
            style={themeStyles}
          />
        ) : null}
      </div>
    </TreeExampleSection>
  );
}
