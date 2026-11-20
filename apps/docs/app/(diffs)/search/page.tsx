'use client';

import type { CodeViewItem } from '@pierre/diffs';
import type { EditorOptions, EditorType } from '@pierre/diffs/edit';
import { CodeView, type CodeViewHandle, File } from '@pierre/diffs/react';
import {
  IconCheck,
  IconChevronSm,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { docsThemeCatalog } from '@/components/themeCatalog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ThemeColorScheme = 'light' | 'dark';

interface ReviewTheme {
  name: string;
  colorScheme: ThemeColorScheme;
}

interface SearchThemeTokens {
  currentBackground?: string;
  currentForeground?: string;
  matchBackground?: string;
  matchForeground?: string;
}

const THEME_NAMES = {
  light: docsThemeCatalog.getThemeNames({ colorScheme: 'light' }),
  dark: docsThemeCatalog.getThemeNames({ colorScheme: 'dark' }),
};
const REVIEW_THEMES: readonly ReviewTheme[] = [
  ...THEME_NAMES.light.map((name) => ({ name, colorScheme: 'light' as const })),
  ...THEME_NAMES.dark.map((name) => ({ name, colorScheme: 'dark' as const })),
];
const AUTO_PROGRESS_MS = 2500;

function getSearchThemeTokens(loaded: unknown): SearchThemeTokens {
  if (loaded == null || typeof loaded !== 'object') return {};
  const themeModule = loaded as { default?: unknown };
  const theme = themeModule.default ?? loaded;
  if (theme == null || typeof theme !== 'object') return {};
  const colors = (theme as { colors?: unknown }).colors;
  if (colors == null || typeof colors !== 'object') return {};
  const values = colors as Record<string, unknown>;
  const read = (key: string) =>
    typeof values[key] === 'string' ? values[key] : undefined;
  return {
    currentBackground: read('editor.findMatchBackground'),
    currentForeground: read('editor.findMatchForeground'),
    matchBackground: read('editor.findMatchHighlightBackground'),
    matchForeground: read('editor.findMatchHighlightForeground'),
  };
}

const SOURCE = `export function searchPanelFixture(value: string) {
  const target = value.trim();
  if (target === '') return 'empty target';
  return target.repeat(3);
}

const otherTarget = searchPanelFixture('target');
console.log(otherTarget);
`;

const CODE_VIEW_ITEMS: CodeViewItem<undefined>[] = [
  {
    id: 'search-panel-fixture',
    type: 'file',
    file: { name: 'search-panel.ts', contents: SOURCE },
  },
];

const SURFACE_STYLE: CSSProperties = {
  display: 'block',
  height: 190,
  overflow: 'auto',
};

function getPanelRoot(container: ParentNode): ShadowRoot | null {
  const panel = container.querySelector<HTMLElement>('[data-search-panel]');
  return panel?.shadowRoot ?? null;
}

function setSyntheticCount(container: ParentNode, count: string): void {
  let attempts = 0;
  const update = () => {
    const matches = getPanelRoot(container)?.querySelector('[data-matches]');
    if (matches != null) {
      matches.textContent = count;
      return;
    }
    attempts += 1;
    if (attempts < 60) {
      window.requestAnimationFrame(update);
    }
  };
  update();
}

// Freezes the panel in its in-progress presentation so the design can be
// reviewed without depending on machine speed or a deliberately slow search.
function setSyntheticSearching(container: ParentNode): void {
  let attempts = 0;
  const update = () => {
    const panel = getPanelRoot(container);
    const matches = panel?.querySelector('[data-matches]');
    if (panel != null && matches != null) {
      const svg = matches.ownerDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg'
      );
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      const use = matches.ownerDocument.createElementNS(
        'http://www.w3.org/2000/svg',
        'use'
      );
      use.setAttribute('href', '#diffs-editor-icon-loader');
      svg.append(use);
      matches.replaceChildren(svg);
      matches.setAttribute('data-searching', '');
      matches.setAttribute('aria-label', 'Searching…');
      matches.removeAttribute('data-no-matches');
      for (const button of panel.querySelectorAll<HTMLButtonElement>(
        '[data-search-nav] button'
      )) {
        button.disabled = true;
      }
      return;
    }
    attempts += 1;
    if (attempts < 60) {
      window.requestAnimationFrame(update);
    }
  };
  update();
}

function openEditorSearch(
  container: HTMLElement,
  mode: 'find' | 'replace',
  query: string,
  syntheticCount?: string
): void {
  let attempts = 0;
  const open = () => {
    const host = container.querySelector<HTMLElement>('diffs-container');
    const activeElement = host?.shadowRoot?.activeElement;
    const content =
      activeElement instanceof HTMLElement &&
      activeElement.matches('[data-content]')
        ? activeElement
        : host?.shadowRoot?.querySelector<HTMLElement>(
            '[data-additions] [data-content], [data-content]'
          );
    if (host == null || content == null) {
      attempts += 1;
      if (attempts < 60) {
        window.requestAnimationFrame(open);
      }
      return;
    }

    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    content.focus({ preventScroll: true });
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      altKey: mode === 'replace',
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    content.dispatchEvent(event);
    if (!event.defaultPrevented) {
      attempts += 1;
      if (attempts < 60) {
        window.requestAnimationFrame(open);
      }
      return;
    }

    let populateAttempts = 0;
    const populate = () => {
      const input = getPanelRoot(
        host.shadowRoot!
      )?.querySelector<HTMLInputElement>('input[data-search]');
      if (input == null) {
        populateAttempts += 1;
        if (populateAttempts < 60) {
          window.requestAnimationFrame(populate);
        }
        return;
      }
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (syntheticCount != null) {
        setSyntheticCount(host.shadowRoot!, syntheticCount);
      }
    };
    populate();
  };
  open();
}

function Case({
  title,
  description,
  narrow = false,
  children,
}: {
  title: string;
  description: string;
  narrow?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-[var(--color-background)] p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <div
        className="overflow-hidden rounded-lg border"
        style={{ maxWidth: narrow ? 360 : undefined }}
      >
        {children}
      </div>
    </section>
  );
}

function ThemeReviewControls({
  selectedThemes,
  colorScheme,
  searchTokens,
  autoProgress,
  onSelectTheme,
  onNavigateTheme,
  onAutoProgressChange,
}: {
  selectedThemes: Record<ThemeColorScheme, string>;
  colorScheme: ThemeColorScheme;
  searchTokens: SearchThemeTokens;
  autoProgress: boolean;
  onSelectTheme(theme: ReviewTheme): void;
  onNavigateTheme(offset: -1 | 1): void;
  onAutoProgressChange(active: boolean): void;
}) {
  const currentTheme = selectedThemes[colorScheme];
  const currentIndex = REVIEW_THEMES.findIndex(
    (theme) => theme.name === currentTheme && theme.colorScheme === colorScheme
  );
  const tokenCount = Object.values(searchTokens).filter(Boolean).length;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-theme-review-controls
      data-theme-name={currentTheme}
      data-theme-color-scheme={colorScheme}
      data-theme-index={currentIndex}
      data-theme-count={REVIEW_THEMES.length}
      data-auto-progress={autoProgress}
      data-search-token-count={tokenCount}
      data-find-match-background={searchTokens.currentBackground ?? ''}
      data-find-match-foreground={searchTokens.currentForeground ?? ''}
      data-find-match-highlight-background={searchTokens.matchBackground ?? ''}
      data-find-match-highlight-foreground={searchTokens.matchForeground ?? ''}
    >
      {(['light', 'dark'] as const).map((scheme) => {
        const Icon = scheme === 'light' ? IconColorLight : IconColorDark;
        return (
          <DropdownMenu key={scheme}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="w-52 max-w-full justify-start"
                aria-label={`Select ${scheme} theme`}
              >
                <Icon className="shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {selectedThemes[scheme]}
                </span>
                <IconChevronSm className="text-muted-foreground ml-auto shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[550px] overflow-auto"
              scrollSelectedIntoView
            >
              {THEME_NAMES[scheme].map((name) => (
                <DropdownMenuItem
                  key={name}
                  onClick={() => onSelectTheme({ name, colorScheme: scheme })}
                  selected={selectedThemes[scheme] === name}
                >
                  {name}
                  {selectedThemes[scheme] === name && (
                    <IconCheck className="ml-auto" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      <Button
        type="button"
        variant="outline"
        className="w-32"
        onClick={() => onNavigateTheme(-1)}
      >
        Previous theme
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-32"
        onClick={() => onNavigateTheme(1)}
      >
        Next theme
      </Button>
      <Button
        type="button"
        variant={autoProgress ? 'secondary' : 'outline'}
        className="w-32"
        aria-pressed={autoProgress}
        onClick={() => onAutoProgressChange(!autoProgress)}
      >
        {autoProgress ? 'Stop auto' : 'Auto progress'}
      </Button>
      <span
        className="text-muted-foreground ml-auto w-14 text-right text-sm tabular-nums"
        aria-live="polite"
      >
        {currentIndex + 1} / {REVIEW_THEMES.length}
      </span>
      <span
        data-theme-search-token-status
        className="text-muted-foreground w-32 text-xs"
        title="editor.findMatchBackground, editor.findMatchForeground, editor.findMatchHighlightBackground, editor.findMatchHighlightForeground"
      >
        Search tokens {tokenCount}/4
      </span>
    </div>
  );
}

function CodeViewCase({
  query,
  mode = 'find',
  syntheticCount,
  activeOptions = false,
  searching = false,
  theme,
  colorScheme,
}: {
  query: string;
  mode?: 'find' | 'replace';
  syntheticCount?: string;
  activeOptions?: boolean;
  searching?: boolean;
  theme: string;
  colorScheme: ThemeColorScheme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<undefined, undefined>>(null);

  useEffect(() => {
    let searchingTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      viewerRef.current?.openSearch({ mode, query, scope: 'all' });
      if (syntheticCount != null && containerRef.current != null) {
        setSyntheticCount(containerRef.current, syntheticCount);
      }
      if (searching) {
        searchingTimer = window.setTimeout(() => {
          if (containerRef.current != null) {
            setSyntheticSearching(containerRef.current);
          }
        }, 500);
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (searchingTimer != null) {
        window.clearTimeout(searchingTimer);
      }
    };
  }, [colorScheme, mode, query, searching, syntheticCount, theme]);

  return (
    <div ref={containerRef}>
      <CodeView
        ref={viewerRef}
        initialItems={CODE_VIEW_ITEMS}
        options={{
          theme,
          themeType: colorScheme,
          searchOptions: activeOptions
            ? { defaults: { caseSensitive: true, wholeWord: true } }
            : undefined,
        }}
        disableWorkerPool
        style={SURFACE_STYLE}
      />
    </div>
  );
}

function EditorCase({
  mode,
  query,
  syntheticCount,
  theme,
  colorScheme,
}: {
  mode: 'find' | 'replace';
  query: string;
  syntheticCount?: string;
  theme: string;
  colorScheme: ThemeColorScheme;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorOptions = useMemo<
    EditorOptions<EditorType, undefined, undefined>
  >(
    () => ({
      onAttach(editor) {
        editor.focus({ lineNumber: 'first-visible', preventScroll: true });
      },
    }),
    []
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (containerRef.current != null) {
        openEditorSearch(containerRef.current, mode, query, syntheticCount);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [colorScheme, mode, query, syntheticCount, theme]);

  return (
    <div ref={containerRef}>
      <div className="flex justify-end border-b px-2 py-1">
        <button
          type="button"
          className="text-muted-foreground rounded px-2 py-1 text-xs hover:text-current"
          onClick={() => {
            if (containerRef.current != null) {
              openEditorSearch(
                containerRef.current,
                mode,
                query,
                syntheticCount
              );
            }
          }}
        >
          Open {mode === 'replace' ? 'find and replace' : 'find'}
        </button>
      </div>
      <File
        file={{ name: 'search-panel.ts', contents: SOURCE }}
        edit
        editorOptions={editorOptions}
        options={{
          theme,
          themeType: colorScheme,
          useTokenTransformer: true,
        }}
        disableWorkerPool
        style={SURFACE_STYLE}
      />
    </div>
  );
}

export default function SearchPanelTestPage() {
  const [selectedThemes, setSelectedThemes] = useState<
    Record<ThemeColorScheme, string>
  >({
    light: 'pierre-light',
    dark: 'pierre-dark',
  });
  const [colorScheme, setColorScheme] = useState<ThemeColorScheme>('light');
  const [autoProgress, setAutoProgress] = useState(false);
  const [searchTokens, setSearchTokens] = useState<SearchThemeTokens>({});
  const currentTheme = selectedThemes[colorScheme];

  useEffect(() => {
    let active = true;
    const descriptor = docsThemeCatalog.getTheme(currentTheme);
    if (descriptor == null) return;
    void Promise.resolve(descriptor.load()).then((loaded) => {
      if (active) setSearchTokens(getSearchThemeTokens(loaded));
    });
    return () => {
      active = false;
    };
  }, [currentTheme]);

  const selectTheme = useCallback((theme: ReviewTheme) => {
    setSelectedThemes((current) => ({
      ...current,
      [theme.colorScheme]: theme.name,
    }));
    setColorScheme(theme.colorScheme);
  }, []);

  const navigateTheme = useCallback(
    (offset: -1 | 1) => {
      const currentIndex = REVIEW_THEMES.findIndex(
        (theme) =>
          theme.name === currentTheme && theme.colorScheme === colorScheme
      );
      const nextIndex =
        (Math.max(currentIndex, 0) + offset + REVIEW_THEMES.length) %
        REVIEW_THEMES.length;
      const nextTheme = REVIEW_THEMES[nextIndex];
      if (nextTheme != null) selectTheme(nextTheme);
    },
    [colorScheme, currentTheme, selectTheme]
  );

  useEffect(() => {
    if (!autoProgress) return;
    const timer = window.setInterval(() => navigateTheme(1), AUTO_PROGRESS_MS);
    return () => window.clearInterval(timer);
  }, [autoProgress, navigateTheme]);

  useEffect(() => {
    const timer = window.setTimeout(() => window.scrollTo(0, 0), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main
      className="mx-auto min-h-screen max-w-6xl p-6"
      data-review-theme={currentTheme}
      data-review-color-scheme={colorScheme}
    >
      <div className="mb-8 flex items-end justify-between gap-6">
        <div>
          <p className="text-muted-foreground mb-1 text-sm">
            One-off visual test route
          </p>
          <h1 className="text-2xl font-semibold">Search panel states</h1>
          <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
            Every panel is live and interactive. Reload to restore any panel
            after closing or editing it.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm font-medium"
          onClick={() => window.location.reload()}
        >
          Reset states
        </button>
      </div>

      <div className="bg-background sticky top-0 z-20 mb-6 rounded-xl border p-3 shadow-sm">
        <ThemeReviewControls
          selectedThemes={selectedThemes}
          colorScheme={colorScheme}
          searchTokens={searchTokens}
          autoProgress={autoProgress}
          onSelectTheme={selectTheme}
          onNavigateTheme={navigateTheme}
          onAutoProgressChange={setAutoProgress}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Case
          title="CodeView · find"
          description="Normal selected-result count and default option states."
        >
          <CodeViewCase
            query="target"
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>

        <Case
          title="CodeView · no matches"
          description="The muted count reads 0/0 while navigation is disabled."
        >
          <CodeViewCase
            query="missing-result"
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>

        <Case
          title="CodeView · actively searching"
          description="Frozen in-progress state for a scan across thousands of files."
        >
          <CodeViewCase
            query="target"
            searching
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>

        <Case
          title="CodeView · large count"
          description="Synthetic count for checking that only the input contracts."
        >
          <CodeViewCase
            query="target"
            syntheticCount="137/135,064"
            activeOptions
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>

        <Case
          title="Standalone File · find"
          description="The editor-owned panel used outside CodeView."
        >
          <EditorCase
            mode="find"
            query="target"
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>

        <Case
          title="Standalone File · find and replace"
          description="Expanded replacement row and action controls."
        >
          <EditorCase
            mode="replace"
            query="target"
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>

        <Case
          title="Standalone File · narrow replace"
          description="Responsive multi-row layout in the editor-owned context."
          narrow
        >
          <EditorCase
            mode="replace"
            query="target"
            theme={currentTheme}
            colorScheme={colorScheme}
          />
        </Case>
      </div>
    </main>
  );
}
