import type { DiffIndicators } from '@pierre/diffs';
import {
  IconCheck,
  IconChevronSm,
  IconCodeStyleBars,
  IconCollapsedRow,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconDiffSplit,
  IconDiffUnified,
  IconExpandAll,
  IconEyeSlash,
  IconFileTreeFill,
  IconGearFill,
  IconShare,
  IconSymbolDiffstat,
} from '@pierre/icons';
import { type ColorMode } from '@pierre/theme-kit';
import Link from 'next/link';
import {
  type CSSProperties,
  type Dispatch,
  memo,
  type SetStateAction,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { DiffUrlForm } from '../../_components/DiffUrlForm';
import { diffshubChromeMapping } from './_theming/js/diffshubChromeMapping';
import { useChromeThemeProps } from './_theming/react/useChromeThemeProps';
import { DiffsHubLogo } from './DiffsHubLogo';
import { docsThemeCatalog } from '@/components/themeCatalog';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type LightThemeName = string;
type DarkThemeName = string;

const SETTING_ROW_CLASS =
  'w-full flex cursor-pointer items-center justify-between gap-4 px-2 py-1.5 text-sm';
const THEMED_DROPDOWN_CONTENT_CLASS =
  'border-[var(--diffshub-popover-border,var(--color-border))] bg-[var(--diffshub-popover-bg,var(--color-popover))] text-[var(--diffshub-popover-fg,var(--color-popover-foreground))] shadow-[var(--diffshub-popover-shadow,0_10px_30px_rgb(0_0_0_/_0.15))]';

interface HeaderProps {
  className?: string;
  collapseMode: 'expanded' | 'collapsed';
  colorMode: ColorMode;
  darkThemeName: DarkThemeName;
  diffIndicators: DiffIndicators;
  diffStyle: 'split' | 'unified';
  fileTreeAvailable: boolean;
  fileTreeOverlayOpen: boolean;
  initialUrl: string;
  lightThemeName: LightThemeName;
  lineNumbers: boolean;
  overflow: 'wrap' | 'scroll';
  onToggleCollapseMode(): void;
  onToggleFileTreeOverlay(): void;
  setColorMode(mode: ColorMode): void;
  setDarkThemeName(name: DarkThemeName): void;
  setDiffIndicators: Dispatch<SetStateAction<DiffIndicators>>;
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  setLightThemeName(name: LightThemeName): void;
  setLineNumbers: Dispatch<SetStateAction<boolean>>;
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  setShowBackgrounds: Dispatch<SetStateAction<boolean>>;
  showBackgrounds: boolean;
}

export const CodeViewHeader = memo(function CodeViewHeader({
  className,
  collapseMode,
  colorMode,
  darkThemeName,
  diffIndicators,
  diffStyle,
  fileTreeAvailable,
  fileTreeOverlayOpen,
  initialUrl,
  lightThemeName,
  lineNumbers,
  overflow,
  onToggleCollapseMode,
  onToggleFileTreeOverlay,
  setColorMode,
  setDarkThemeName,
  setDiffIndicators,
  setDiffStyle,
  setLightThemeName,
  setLineNumbers,
  setOverflow,
  setShowBackgrounds,
  showBackgrounds,
}: HeaderProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  // Only show the external-link button when the input still reflects the
  // committed URL — otherwise we'd be pointing at a draft the user is editing.
  const showExternalLink = currentUrl === initialUrl;
  // Mirror the sidebar's themed chrome so the header bar lives on the same
  // Shiki surface (background, text, icons, borders) instead of the global
  // light/dark palette. Falls back to the diffshub-sidebar-bg CSS variable
  // on first render while the theme is still resolving.
  const { style: headerChromeStyle } = useChromeThemeProps(
    diffshubChromeMapping
  );
  const themeChromeStyle =
    Object.keys(headerChromeStyle).length > 0 ? headerChromeStyle : undefined;
  const dropdownThemeStyle = useMemo(
    () => getDropdownThemeStyle(themeChromeStyle),
    [themeChromeStyle]
  );
  return (
    <div
      className={cn(
        'z-10 contain-layout contain-paint flex flex-wrap md:flex-nowrap items-center gap-2.5 pt-3 pb-2 px-4 md:px-3 md:py-1.5 border-b border-[var(--color-border-opaque)]',
        themeChromeStyle == null &&
          'bg-background md:bg-[var(--diffshub-sidebar-bg)]',
        className
      )}
      style={themeChromeStyle}
    >
      <Link
        href="/"
        className="absolute top-4 left-[50%] inline-flex -translate-x-1/2 transition-transform duration-200 hover:scale-110 md:static md:translate-x-0"
      >
        <DiffsHubLogo />
      </Link>
      <DiffUrlForm
        className="order-last md:order-none md:mr-auto"
        initialUrl={initialUrl}
        onUrlChange={setCurrentUrl}
        placeholder="https://github.com/org/repo/123"
        inputClassName="w-full md:w-auto"
      />
      <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon-md"
          aria-pressed={fileTreeOverlayOpen}
          disabled={!fileTreeAvailable}
          title={fileTreeOverlayOpen ? 'Hide file tree' : 'Show file tree'}
          className="hover:text-muted-foreground hover:bg-transparent md:hidden"
          onClick={onToggleFileTreeOverlay}
        >
          <IconFileTreeFill className="size-4 md:size-3" />
        </Button>
        <div className="flex items-center gap-2">
          {showExternalLink && (
            <>
              <Button
                asChild
                variant="ghost"
                size="icon-md"
                aria-label="Open source in new tab"
                title="Open source in new tab"
                className="hover:text-muted-foreground hidden hover:bg-transparent md:flex"
              >
                <a href={initialUrl} target="_blank" rel="noreferrer noopener">
                  <IconShare className="size-4 md:size-3" />
                </a>
              </Button>
              <div className="bg-border hidden h-3 w-px md:block" />
            </>
          )}
          <div className="flex items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              title={
                diffStyle === 'split'
                  ? 'Switch to unified view'
                  : 'Switch to split view'
              }
              className="hover:text-muted-foreground hidden hover:bg-transparent md:flex"
              onClick={() =>
                setDiffStyle(diffStyle === 'split' ? 'unified' : 'split')
              }
            >
              {diffStyle === 'split' ? (
                <IconDiffSplit className="size-4 md:size-3" />
              ) : (
                <IconDiffUnified className="size-4 md:size-3" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-md"
              aria-pressed={collapseMode === 'collapsed'}
              title={
                collapseMode === 'expanded'
                  ? 'Collapse all files'
                  : 'Expand all files'
              }
              className="hover:text-muted-foreground hover:bg-transparent"
              onClick={onToggleCollapseMode}
            >
              {collapseMode === 'expanded' ? (
                <IconExpandAll className="size-4 md:size-3" />
              ) : (
                <IconCollapsedRow className="size-4 md:size-3" />
              )}
            </Button>
            <ThemeDropdown
              colorMode={colorMode}
              darkThemeName={darkThemeName}
              lightThemeName={lightThemeName}
              setColorMode={setColorMode}
              setDarkThemeName={setDarkThemeName}
              setLightThemeName={setLightThemeName}
              themeDropdownStyle={dropdownThemeStyle}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-md"
                  aria-label="Display settings"
                  title="Display settings"
                  className="hover:text-muted-foreground hover:bg-transparent"
                >
                  <IconGearFill className="size-4 md:size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className={cn('w-52', THEMED_DROPDOWN_CONTENT_CLASS)}
                style={dropdownThemeStyle}
              >
                <DropdownMenuItem
                  className="cursor-default p-0"
                  onSelect={(e) => e.preventDefault()}
                >
                  <label className={SETTING_ROW_CLASS}>
                    <span className="min-w-0 flex-1">Backgrounds</span>
                    <Switch
                      checked={showBackgrounds}
                      onCheckedChange={setShowBackgrounds}
                    />
                  </label>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-default p-0"
                  onSelect={(e) => e.preventDefault()}
                >
                  <label className={SETTING_ROW_CLASS}>
                    <span className="min-w-0 flex-1">Line numbers</span>
                    <Switch
                      checked={lineNumbers}
                      onCheckedChange={setLineNumbers}
                    />
                  </label>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-default p-0"
                  onSelect={(e) => e.preventDefault()}
                >
                  <label className={SETTING_ROW_CLASS}>
                    <span className="min-w-0 flex-1">Word wrap</span>
                    <Switch
                      checked={overflow === 'wrap'}
                      onCheckedChange={(checked) =>
                        setOverflow(checked ? 'wrap' : 'scroll')
                      }
                    />
                  </label>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="w-full px-2 focus:bg-transparent"
                  onSelect={(e) => e.preventDefault()}
                >
                  <span>Indicator style</span>
                  <ButtonGroup
                    className="ml-auto"
                    value={diffIndicators}
                    onValueChange={(value) =>
                      setDiffIndicators(value as DiffIndicators)
                    }
                  >
                    <ButtonGroupItem value="bars" className="size-7 p-0">
                      <IconCodeStyleBars className="size-3" />
                    </ButtonGroupItem>
                    <ButtonGroupItem value="classic" className="size-7 p-0">
                      <IconSymbolDiffstat className="size-3" />
                    </ButtonGroupItem>
                    <ButtonGroupItem value="none" className="size-7 p-0">
                      <IconEyeSlash className="size-3" />
                    </ButtonGroupItem>
                  </ButtonGroup>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <hr className="border-border/80 w-full md:hidden" />
    </div>
  );
});

function colorModeIcon(colorMode: ColorMode) {
  if (colorMode === 'light') return IconColorLight;
  if (colorMode === 'dark') return IconColorDark;
  return IconColorAuto;
}

function getDropdownThemeStyle(
  themeChromeStyle: CSSProperties | undefined
): CSSProperties | undefined {
  if (themeChromeStyle == null) {
    return undefined;
  }

  return {
    ...themeChromeStyle,
    backgroundColor: 'var(--diffshub-popover-bg, var(--color-popover))',
    borderColor: 'var(--diffshub-popover-border, var(--color-border))',
    boxShadow: 'var(--diffshub-popover-shadow, 0 10px 30px rgb(0 0 0 / 0.15))',
    color: 'var(--diffshub-popover-fg, var(--color-popover-foreground))',
  };
}

interface ThemeDropdownProps {
  colorMode: ColorMode;
  darkThemeName: DarkThemeName;
  lightThemeName: LightThemeName;
  setColorMode(mode: ColorMode): void;
  setDarkThemeName(name: DarkThemeName): void;
  setLightThemeName(name: LightThemeName): void;
  themeDropdownStyle?: CSSProperties;
}

// Theme picker shown next to the gear icon. Avoids horizontal sub-menus
// (which overflow on narrow viewports) by re-using the same DropdownMenu
// content for three "views" — main, light theme list, dark theme list —
// switched via local state. The user enters a list by clicking the
// corresponding row, picks a theme, and is returned to the main view. The
// menu auto-resets to the main view whenever it closes so the next open
// always starts from the top.
function ThemeDropdown({
  colorMode,
  darkThemeName,
  lightThemeName,
  setColorMode,
  setDarkThemeName,
  setLightThemeName,
  themeDropdownStyle,
}: ThemeDropdownProps) {
  const TriggerIcon = colorModeIcon(colorMode);
  const [view, setView] = useState<'main' | 'light' | 'dark'>('main');
  // Only offer a reset when at least one slot drifts from the default
  // pierre pair, so the link stays out of the way until it's useful.
  const themesAreCustom =
    lightThemeName !== docsThemeCatalog.defaultLightThemeName ||
    darkThemeName !== docsThemeCatalog.defaultDarkThemeName;
  return (
    // `modal={false}` lets the user scroll and click the code view while the
    // theme picker is open. The default Radix DropdownMenu blocks pointer
    // events outside its content (incl. wheel/scroll), which made the diff
    // feel frozen while previewing themes.
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (!open) setView('main');
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Theme settings"
          title="Theme settings"
          className="hover:text-muted-foreground hover:bg-transparent"
        >
          <TriggerIcon className="size-4 md:size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn('w-72 p-2', THEMED_DROPDOWN_CONTENT_CLASS)}
        style={themeDropdownStyle}
      >
        {view === 'main' ? (
          <>
            <DropdownMenuItem
              className="cursor-default p-0 focus:bg-transparent"
              onSelect={(event) => event.preventDefault()}
            >
              <ButtonGroup
                className="w-full"
                value={colorMode}
                onValueChange={(value) => {
                  if (
                    value === 'system' ||
                    value === 'light' ||
                    value === 'dark'
                  ) {
                    setColorMode(value);
                  }
                }}
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
            </DropdownMenuItem>
            <DropdownMenuItem
              className="mt-1 flex cursor-pointer items-center gap-2"
              onSelect={(event) => {
                event.preventDefault();
                setView('light');
              }}
            >
              <IconColorLight />
              <span className="min-w-0 flex-1 truncate">{lightThemeName}</span>
              <IconChevronSm
                aria-hidden
                className="text-muted-foreground -rotate-90"
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2"
              onSelect={(event) => {
                event.preventDefault();
                setView('dark');
              }}
            >
              <IconColorDark />
              <span className="min-w-0 flex-1 truncate">{darkThemeName}</span>
              <IconChevronSm
                aria-hidden
                className="text-muted-foreground -rotate-90"
              />
            </DropdownMenuItem>
            {themesAreCustom && (
              <DropdownMenuItem
                className="text-muted-foreground hover:text-foreground mt-1 cursor-pointer justify-center text-xs focus:bg-transparent"
                onSelect={(event) => {
                  event.preventDefault();
                  setLightThemeName(docsThemeCatalog.defaultLightThemeName);
                  setDarkThemeName(docsThemeCatalog.defaultDarkThemeName);
                }}
              >
                Reset to default themes
              </DropdownMenuItem>
            )}
          </>
        ) : (
          <ThemeList
            view={view}
            currentLight={lightThemeName}
            currentDark={darkThemeName}
            onBack={() => setView('main')}
            onPickLight={(theme) => {
              setLightThemeName(theme);
              setColorMode('light');
              setView('main');
            }}
            onPickDark={(theme) => {
              setDarkThemeName(theme);
              setColorMode('dark');
              setView('main');
            }}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ThemeListProps {
  view: 'light' | 'dark';
  currentLight: LightThemeName;
  currentDark: DarkThemeName;
  onBack(): void;
  onPickLight(theme: LightThemeName): void;
  onPickDark(theme: DarkThemeName): void;
}

// Inline list of theme names shown after the user enters the light or dark
// "view" from the main panel. The list is keyboard-friendly (each row is a
// DropdownMenuItem) and scrolls in place so it fits inside the same
// dropdown content even on narrow viewports.
function ThemeList({
  view,
  currentLight,
  currentDark,
  onBack,
  onPickLight,
  onPickDark,
}: ThemeListProps) {
  const isLight = view === 'light';
  const themes = docsThemeCatalog.getThemeNames({
    colorScheme: isLight ? 'light' : 'dark',
  });
  const current = isLight ? currentLight : currentDark;
  const HeaderIcon = isLight ? IconColorLight : IconColorDark;
  // Auto-scroll so the currently-selected row sits at the second visible
  // position when the list opens. The current theme lands right under the
  // user's cursor (Radix opens the menu under the trigger) and the row
  // above it makes the previous theme easy to reach with one tap of the
  // up arrow — sequential browsing through themes feels natural without
  // the user having to hunt for the active row first.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    const selected = selectedItemRef.current;
    if (container == null || selected == null) return;
    // `offsetTop` measures from the nearest positioned ancestor, which the
    // scroll container is not — use bounding rects so the math works
    // regardless of where ancestors set `position`. Subtract one row
    // height so the selected row appears as the second-from-top visible
    // row instead of flush with the top.
    const containerTop = container.getBoundingClientRect().top;
    const selectedTop = selected.getBoundingClientRect().top;
    const offsetWithinScroll = selectedTop - containerTop + container.scrollTop;
    const rowHeight = selected.offsetHeight;
    container.scrollTop = Math.max(0, offsetWithinScroll - rowHeight);
  }, [view]);
  return (
    <>
      <DropdownMenuItem
        className="flex cursor-pointer items-center gap-2"
        onSelect={(event) => {
          event.preventDefault();
          onBack();
        }}
      >
        <IconChevronSm
          aria-hidden
          className="text-muted-foreground rotate-90"
        />
        <HeaderIcon />
        <span className="flex-1 truncate">
          {isLight ? 'Light theme' : 'Dark theme'}
        </span>
      </DropdownMenuItem>
      <div
        ref={scrollContainerRef}
        className="cv-mini-scrollbar mt-1 max-h-[320px] overflow-y-auto overscroll-contain"
      >
        {themes.map((theme) => (
          <DropdownMenuItem
            key={theme}
            ref={current === theme ? selectedItemRef : undefined}
            onSelect={(event) => {
              event.preventDefault();
              if (isLight) {
                onPickLight(theme);
              } else {
                onPickDark(theme);
              }
            }}
            selected={current === theme}
          >
            <span className="flex-1 truncate">{theme}</span>
            {current === theme ? (
              <IconCheck className="ml-auto" />
            ) : (
              <div className="ml-2 h-4 w-4" />
            )}
          </DropdownMenuItem>
        ))}
      </div>
    </>
  );
}
