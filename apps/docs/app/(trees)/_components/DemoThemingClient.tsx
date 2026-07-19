'use client';

import { resolveTheme } from '@pierre/diffs';
import {
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { sampleFileList } from '../_lib/demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from '../_lib/dimensions';
import {
  TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
  TREE_NEW_GIT_STATUSES,
} from '../_lib/gitStatusDemoData';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
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
import { PRODUCTS } from '@/lib/product-config';

type LightThemeName = string;
type DarkThemeName = string;

interface DemoThemingClientProps {
  initialThemeStyles: TreeThemeStyles;
  preloadedData: FileTreePreloadedData;
}

export function DemoThemingClient({
  initialThemeStyles,
  preloadedData,
}: DemoThemingClientProps) {
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus: TREE_NEW_GIT_STATUSES,
    id: 'trees-shiki-themes-tree',
    initialExpandedPaths: TREE_NEW_GIT_STATUS_EXPANDED_PATHS,
    initialSelectedPaths: ['package.json'],
    paths: sampleFileList,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.theming / 30,
  });
  const [selectedLightTheme, setSelectedLightTheme] =
    useState<LightThemeName>('pierre-light');
  const [selectedDarkTheme, setSelectedDarkTheme] =
    useState<DarkThemeName>('pierre-dark');
  const [colorMode, setColorMode] = useState<'system' | 'light' | 'dark'>(
    'system'
  );
  const [themeStyles, setThemeStyles] = useState<TreeThemeStyles | null>(
    initialThemeStyles
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefersDark, setPrefersDark] = useState(false);

  useEffect(() => {
    const mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    setPrefersDark(mediaQueryList.matches);
    const listener = () => setPrefersDark(mediaQueryList.matches);
    mediaQueryList.addEventListener('change', listener);
    return () => mediaQueryList.removeEventListener('change', listener);
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
    setLoading(true);
    try {
      const theme = await resolveTheme(
        themeName as Parameters<typeof resolveTheme>[0]
      );
      setThemeStyles(themeToTreeStyles(theme));
    } catch (themeError) {
      setError(
        themeError instanceof Error ? themeError.message : String(themeError)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTheme(effectiveTheme);
  }, [effectiveTheme, loadTheme]);

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="theming"
        title="Use Shiki themes"
        description={
          <>
            The same Shiki themes from{' '}
            <Link href="../" className="inline-link">
              <code>@pierre/diffs</code>
            </Link>{' '}
            can style the <code>FileTree</code>. The theme you choose sets the
            sidebar and Git decoration colors. Pick a theme. Switch between
            light and dark. The tree updates live. See the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#styling-and-theming`}
              className="inline-link"
            >
              styling and theming reference
            </Link>{' '}
            for more.
          </>
        }
      />
      <div className="flex flex-wrap gap-3 md:items-center">
        <div className="flex gap-3">
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
                      setColorMode('light');
                    }}
                    selected={selectedLightTheme === theme}
                  >
                    {theme}
                    {selectedLightTheme === theme ? (
                      <IconCheck className="ml-auto" />
                    ) : null}
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
          className="min-[500px]:ml-auto md:ml-0"
          value={colorMode}
          onValueChange={(value) =>
            setColorMode(value as 'system' | 'light' | 'dark')
          }
        >
          <ButtonGroupItem value="system" className="flex-1">
            <IconColorAuto />
            <span className="hidden md:inline">Auto</span>
          </ButtonGroupItem>
          <ButtonGroupItem value="light" className="flex-1">
            <IconColorLight />
            <span className="hidden md:inline">Light</span>
          </ButtonGroupItem>
          <ButtonGroupItem value="dark" className="flex-1">
            <IconColorDark />
            <span className="hidden md:inline">Dark</span>
          </ButtonGroupItem>
        </ButtonGroup>
      </div>

      <div>
        {loading && themeStyles == null ? (
          <p className="text-muted-foreground py-4 text-sm">Loading theme…</p>
        ) : null}
        {error != null ? (
          <p className="text-destructive py-4 text-sm">{error}</p>
        ) : null}
        {themeStyles != null ? (
          <FileTree
            className={`${getDefaultFileTreePanelClass()} min-h-[320px]`}
            model={model}
            preloadedData={preloadedData}
            style={{
              ...themeStyles,
              height: `${String(TREE_NEW_VIEWPORT_HEIGHTS.theming)}px`,
            }}
          />
        ) : null}
      </div>
      <PierreThemeFootnote />
    </TreeExampleSection>
  );
}
