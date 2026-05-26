'use client';

import { type DiffIndicators } from '@pierre/diffs';
import { type CodeViewHandle, useWorkerPool } from '@pierre/diffs/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { preloadAvatars } from './annotation-shared';
import { CodeViewHeader } from './CodeViewHeader';
import { CodeViewSidebar } from './CodeViewSidebar';
import { CodeViewStatusPanel } from './CodeViewStatusPanel';
import { CodeViewWrapper } from './CodeViewWrapper';
import {
  type ColorMode,
  DARK_THEMES,
  type DarkTheme,
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  LIGHT_THEMES,
  type LightTheme,
} from './themes';
import type {
  CodeViewDeletedCommentEvent,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentEvent,
  CommentMetadata,
} from './types';
import { usePatchLoader } from './usePatchLoader';
import { usePersistedState } from './usePersistedState';
import {
  removeSavedCommentSidebarEntry,
  upsertSavedCommentSidebarEntry,
} from './utils';
import { useTheme } from '@/components/theme-provider';

const LIGHT_THEME_STORAGE_KEY = 'diffshub-light-theme';
const DARK_THEME_STORAGE_KEY = 'diffshub-dark-theme';

interface ReviewUIProps {
  domain?: string;
  initialUrl: string;
  path: string;
}

export function ReviewUI({ domain, initialUrl, path }: ReviewUIProps) {
  useEffect(preloadAvatars, []);

  const isWorkerPoolReadyOrDisable = useIsWorkerPoolReadyOrDisabled();
  const workerPool = useWorkerPool();
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [collapseMode, setCollapseMode] = useState<'expanded' | 'collapsed'>(
    'expanded'
  );
  const [fileTreeOverlayOpen, setFileTreeOverlayOpen] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const [showBackgrounds, setShowBackgrounds] = useState(true);
  const [diffIndicators, setDiffIndicators] = useState<DiffIndicators>('bars');
  const [lineNumbers, setLineNumbers] = useState(true);
  // Light/dark theme picks persist across reloads via localStorage. The
  // hook reads after mount (not during render) so the SSR markup always
  // uses the defaults and React's hydration check stays happy. The
  // `*Hydrated` flags let downstream effects wait for the real values
  // before pushing them through to long-lived singletons.
  const [lightTheme, setLightTheme, lightThemeHydrated] =
    usePersistedState<LightTheme>(
      LIGHT_THEME_STORAGE_KEY,
      DEFAULT_LIGHT_THEME,
      LIGHT_THEMES
    );
  const [darkTheme, setDarkTheme, darkThemeHydrated] =
    usePersistedState<DarkTheme>(
      DARK_THEME_STORAGE_KEY,
      DEFAULT_DARK_THEME,
      DARK_THEMES
    );
  const themesHydrated = lightThemeHydrated && darkThemeHydrated;
  // The diffshub UI shares its color mode with the surrounding ThemeProvider
  // so picking Auto/Light/Dark flips both the CodeView's `themeType` and the
  // app's <html> light/dark class (the tree sidebar, header, etc.).
  // `theme` from useTheme() can briefly be undefined during initial mount
  // before localStorage is read; fall back to 'system' so the header doesn't
  // render an empty selection.
  const { theme: appTheme, setTheme: setColorMode } = useTheme();
  const colorMode: ColorMode = (appTheme as ColorMode | undefined) ?? 'system';

  // Push theme changes through the WorkerPool so background tokenizers reload
  // the active light/dark Shiki themes. Without this, workers keep using the
  // pair they were initialized with and the diff continues to render with the
  // old theme even though the option object changed.
  //
  // The hydration gate is critical for client-side navigation: the WorkerPool
  // is a long-lived singleton that survives across routes. On a second visit
  // to a diff (e.g. logo → home → another PR) ReviewUI remounts with the
  // theme state at DEFAULT_*_THEME for one render until usePersistedState
  // rehydrates from localStorage. Without the gate, that initial pass would
  // call setRenderOptions(DEFAULT) — clearing the pool's caches and kicking
  // off a re-tokenization with the wrong theme — before the rehydration
  // pass corrected it. Waiting until both themes are hydrated keeps the
  // pool on the user's selection through the whole mount.
  //
  // useLayoutEffect (not useEffect) so the worker pool's synchronous
  // rerender — which writes the new themeStyles CSS into the diff
  // containers' shadow roots — happens in the same commit/paint as the
  // sidebar's inline-style update. A plain useEffect runs after paint,
  // which made the diff side trail the chrome by one frame and was
  // visible as a flicker on the comment cards and tab badge during fast
  // theme cycling.
  useLayoutEffect(() => {
    if (workerPool == null) return;
    if (!themesHydrated) return;
    void workerPool.setRenderOptions({
      theme: { dark: darkTheme, light: lightTheme },
    });
  }, [workerPool, darkTheme, lightTheme, themesHydrated]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata> | null>(null);
  const handlePatchLoadStart = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);
  const {
    applyCollapseModeToLoaded,
    commentFileByItemId,
    commentSections,
    diffStats,
    errorMessage,
    initialItems,
    loadState,
    onLineLinkChange,
    onViewerReady,
    retryLoad,
    setCommentSections,
    treeSource,
    viewerKey,
  } = usePatchLoader({
    collapseMode,
    domain,
    onLoadStart: handlePatchLoadStart,
    path,
    viewerRef,
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateMobileState = (matches: boolean) => {
      setDiffStyle(matches ? 'unified' : 'split');
      if (!matches) setFileTreeOverlayOpen(false);
    };
    const handleChange = (event: MediaQueryListEvent) => {
      updateMobileState(event.matches);
    };

    updateMobileState(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);
  const handleSelectTreeItem = useCallback((itemId: string) => {
    setFileTreeOverlayOpen(false);
    const viewer = viewerRef.current;
    if (viewer == null) {
      return;
    }
    const item = viewer.getItem(itemId);
    if (item != null && item.collapsed === true) {
      item.collapsed = false;
      item.version = typeof item.version === 'number' ? item.version + 1 : 1;
      viewer.updateItem(item);
    }
    viewer.scrollTo({
      type: 'item',
      id: itemId,
      align: 'start',
      behavior: 'smooth',
    });
  }, []);
  const handleToggleCollapseMode = useCallback(() => {
    const next = collapseMode === 'expanded' ? 'collapsed' : 'expanded';
    setCollapseMode(next);
    applyCollapseModeToLoaded(next);
  }, [applyCollapseModeToLoaded, collapseMode]);
  const handleCommentSaved = useCallback(
    (comment: CodeViewSavedCommentEvent) => {
      setCommentSections((prev) =>
        upsertSavedCommentSidebarEntry(prev, commentFileByItemId, comment)
      );
    },
    [commentFileByItemId, setCommentSections]
  );
  const handleCommentDeleted = useCallback(
    (comment: CodeViewDeletedCommentEvent) => {
      setCommentSections((prev) =>
        removeSavedCommentSidebarEntry(prev, comment)
      );
    },
    [setCommentSections]
  );
  const handleToggleFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen((open) => !open);
  }, []);
  const handleCloseFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);
  const handleSelectComment = useCallback(
    (comment: CodeViewSavedCommentEntry) => {
      setFileTreeOverlayOpen(false);
      viewerRef.current?.setSelectedLines({
        id: comment.itemId,
        range: comment.range,
      });
      viewerRef.current?.scrollTo({
        type: 'line',
        id: comment.itemId,
        lineNumber: comment.range.end,
        side: comment.range.endSide ?? comment.range.side,
        align: 'center',
        behavior: 'smooth-auto',
      });
    },
    []
  );
  // Withhold the viewer until the persisted themes have been read from
  // localStorage. Otherwise on client-side navigation back into a diff the
  // CodeView would mount during the brief render where lightTheme/darkTheme
  // are still at their `DEFAULT_*_THEME` initial values and tokenize the
  // first batch of files against the wrong palette.
  const viewerAvailable =
    isWorkerPoolReadyOrDisable &&
    themesHydrated &&
    (loadState === 'ready' ||
      (loadState === 'streaming' && initialItems.length > 0));

  return (
    <ReviewGrid>
      <CodeViewHeader
        className="[grid-area:header]"
        collapseMode={collapseMode}
        colorMode={colorMode}
        darkTheme={darkTheme}
        diffIndicators={diffIndicators}
        diffStyle={diffStyle}
        initialUrl={initialUrl}
        lightTheme={lightTheme}
        lineNumbers={lineNumbers}
        overflow={overflow}
        fileTreeOverlayOpen={fileTreeOverlayOpen}
        fileTreeAvailable={treeSource != null}
        onToggleCollapseMode={handleToggleCollapseMode}
        onToggleFileTreeOverlay={handleToggleFileTreeOverlay}
        setColorMode={setColorMode}
        setDarkTheme={setDarkTheme}
        setDiffIndicators={setDiffIndicators}
        setDiffStyle={setDiffStyle}
        setLightTheme={setLightTheme}
        setLineNumbers={setLineNumbers}
        setOverflow={setOverflow}
        setShowBackgrounds={setShowBackgrounds}
        showBackgrounds={showBackgrounds}
      />
      {viewerAvailable && treeSource != null ? (
        <>
          <CodeViewSidebar
            className="[grid-area:viewer] md:[grid-area:tree]"
            commentSections={commentSections}
            darkTheme={darkTheme}
            diffStats={diffStats}
            lightTheme={lightTheme}
            mobileOverlayOpen={fileTreeOverlayOpen}
            onMobileClose={handleCloseFileTreeOverlay}
            onSelectComment={handleSelectComment}
            scrollRef={scrollRef}
            source={treeSource}
            streaming={loadState === 'streaming'}
            onSelectItem={handleSelectTreeItem}
          />
          <CodeViewWrapper
            key={viewerKey}
            className="[grid-area:viewer]"
            darkTheme={darkTheme}
            diffStyle={diffStyle}
            lightTheme={lightTheme}
            overflow={overflow}
            showBackgrounds={showBackgrounds}
            diffIndicators={diffIndicators}
            lineNumbers={lineNumbers}
            scrollRef={scrollRef}
            themeType={colorMode}
            viewerRef={viewerRef}
            initialItems={initialItems}
            onCommentDeleted={handleCommentDeleted}
            onCommentSaved={handleCommentSaved}
            onLineLinkChange={onLineLinkChange}
            onViewerReady={onViewerReady}
          />
        </>
      ) : (
        <CodeViewStatusPanel
          state={loadState}
          errorMessage={errorMessage}
          onRetry={retryLoad}
        />
      )}
    </ReviewGrid>
  );
}

function useIsWorkerPoolReadyOrDisabled() {
  const workerPool = useWorkerPool();
  const [isReady, setIsReady] = useState(
    () => workerPool?.isInitialized() ?? true
  );
  const isReadyRef = useRef(isReady);
  useEffect(() => {
    // The callback will always be fired immediately with the new state, so we
    // don't need to check for it in the effect
    return workerPool?.subscribeToStatChanges((stats) => {
      const isReady = stats.managerState === 'initialized';
      if (isReady !== isReadyRef.current) {
        setIsReady(isReady);
        isReadyRef.current = isReady;
      }
    });
  }, [workerPool]);
  return isReady;
}

interface ReviewGridProps {
  children: ReactNode;
}

function ReviewGrid({ children }: ReviewGridProps) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden overscroll-contain contain-strict [grid-template-areas:'header''viewer'] md:grid-cols-[320px_minmax(0,1fr)] md:[grid-template-areas:'header_header''tree_viewer']">
      {children}
    </div>
  );
}
