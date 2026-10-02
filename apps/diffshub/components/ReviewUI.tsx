'use client';

import { type DiffIndicators } from '@pierre/diffs';
import { type CodeViewHandle, useWorkerPool } from '@pierre/diffs/react';
import { type ColorMode } from '@pierre/theming';
import { useThemeController } from '@pierre/theming/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { DiffsHubHeader } from './DiffsHubHeader';
import { DiffsHubSidebar } from './DiffsHubSidebar';
import { DiffsHubStatusPanel } from './DiffsHubStatusPanel';
import { DiffsHubViewer } from './DiffsHubViewer';
import { ThemeSourceProvider } from './ThemeSourceProvider';
import { useGitHubComments } from './useGitHubComments';
import { useGitHubDiffFileLoader } from './useGitHubDiffFileLoader';
import { useGitHubSession } from './useGitHubSession';
import { useGitHubToken } from './useGitHubToken';
import { useIsHydrated } from './useIsHydrated';
import { useMediaQuery } from './useMediaQuery';
import { useOnValueChange } from './useOnValueChange';
import { usePatchLoader } from './usePatchLoader';
import { useThemeCycle } from './useThemeCycle';
import {
  docsThemeCatalog,
  themeController,
} from '@/components/themeController';
import { parseGitHubDiffSource } from '@/lib/githubDiffSource';
import type { DarkThemeName, LightThemeName } from '@/lib/themeNames';
import type { CommentMetadata, DiffsHubSavedCommentEntry } from '@/lib/types';

const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

interface ReviewUIProps {
  domain?: string;
  initialUrl: string;
  path: string;
}

export function ReviewUI({ domain, initialUrl, path }: ReviewUIProps) {
  // Provide the diffshub-scoped theme context, then render the body BELOW it so
  // the diffs hook + selection hook can read the controller context.
  return (
    <ThemeSourceProvider controller={themeController}>
      <ReviewUIInner domain={domain} initialUrl={initialUrl} path={path} />
    </ThemeSourceProvider>
  );
}

function ReviewUIInner({ domain, initialUrl, path }: ReviewUIProps) {
  const isWorkerPoolReadyOrDisable = useIsWorkerPoolReadyOrDisabled();
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [collapseMode, setCollapseMode] = useState<'expanded' | 'collapsed'>(
    'expanded'
  );
  const [fileTreeOverlayOpen, setFileTreeOverlayOpen] = useState(false);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const [showBackgrounds, setShowBackgrounds] = useState(true);
  const [diffIndicators, setDiffIndicators] = useState<DiffIndicators>('bars');
  const [lineNumbers, setLineNumbers] = useState(true);
  const {
    clearToken: clearGitHubToken,
    hasToken: hasGitHubToken,
    setToken: setGitHubToken,
    token: githubToken,
    tokenVersion: githubTokenVersion,
  } = useGitHubToken();
  const session = useGitHubSession();
  const user = session.status === 'ready' ? session.user : null;
  const source = domain == null ? parseGitHubDiffSource(path) : undefined;
  const commentKind =
    source?.kind === 'pull' || source?.kind === 'commit' ? source.kind : null;
  const authVersion = `${githubTokenVersion}:${user?.id ?? ''}`;
  const { getGitHubToken, loadDiffFiles } = useGitHubDiffFileLoader({
    domain,
    hasGitHubToken: hasGitHubToken || user != null,
    path,
    token: githubToken,
    tokenVersion: authVersion,
  });
  // All theming state — color mode and the light/dark theme-name picks — lives
  // in the single @pierre/theming controller (the same instance the app-wide
  // ThemeProvider is bound to). Reading it here means picking Auto/Light/Dark
  // flips both the CodeView's `themeType` and the app's <html> class, and the
  // theme-name picks persist with no separate local state.
  const themeState = useThemeController(themeController);

  // The controller reads persisted values synchronously when its module loads
  // on the client, so useSyncExternalStore would surface them on the very first
  // client render — but the server rendered the defaults. Gate every
  // theme-derived value (rendered into inline chrome styles + the CodeView
  // themeType) behind a hydration snapshot so the first client render matches
  // the SSR markup, then flips to the user's selection. This also keeps the
  // long-lived WorkerPool and the CodeView from mounting against the default
  // palette before the persisted values apply.
  const themesHydrated = useIsHydrated();

  const colorMode: ColorMode = themesHydrated ? themeState.mode : 'system';
  const appResolvedTheme = themesHydrated
    ? themeState.resolvedColorScheme
    : undefined;
  const lightThemeName = themesHydrated
    ? themeState.lightThemeName
    : docsThemeCatalog.defaultLightThemeName;
  const darkThemeName = themesHydrated
    ? themeState.darkThemeName
    : docsThemeCatalog.defaultDarkThemeName;
  const setColorMode = useCallback((mode: ColorMode) => {
    themeController.setColorMode(mode);
  }, []);
  const setLightThemeName = useCallback((name: LightThemeName) => {
    themeController.setThemeNameForScheme('light', name);
  }, []);
  const setDarkThemeName = useCallback((name: DarkThemeName) => {
    themeController.setThemeNameForScheme('dark', name);
  }, []);
  // The cycle button in the System Monitor sweeps through every Shiki
  // theme so reviewers can preview the full set without manually picking
  // each one. The hook captures the user's current pick when cycling
  // starts so the visible theme anchors the rotation.
  const themeCycle = useThemeCycle({
    lightThemeName,
    darkThemeName,
    resolvedThemeMode: appResolvedTheme,
    setLightThemeName,
    setDarkThemeName,
    setColorMode,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewHandle<CommentMetadata, undefined> | null>(
    null
  );
  const handlePatchLoadStart = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);
  const {
    applyCollapseModeToLoaded,
    commentFileByItemId,
    commitId,
    diffStats,
    errorMessage,
    initialItems,
    loadState,
    onLineLinkChange,
    onViewerReady,
    retryLoad,
    treeSource,
    viewerKey,
  } = usePatchLoader({
    collapseMode,
    domain,
    getGitHubToken,
    githubTokenVersion: authVersion,
    onLoadStart: handlePatchLoadStart,
    path,
    viewerRef,
  });
  const comments = useGitHubComments({
    path,
    commitId: commentKind != null && loadState === 'ready' ? commitId : null,
    userId: user?.id,
    viewerKey,
    files: commentFileByItemId,
    viewerRef,
  });
  const { sync: syncComments } = comments;
  const handleViewerReady = useCallback(() => {
    onViewerReady();
    syncComments();
  }, [onViewerReady, syncComments]);

  // Crossing the mobile breakpoint picks the diff style for that width and
  // closes the file-tree overlay when leaving mobile; the user can still change
  // the style until the next crossing. Applied before the render commits, so
  // the first client render already shows the right style. The comparison is
  // seeded with `undefined`, the server snapshot: a hydrating render reports
  // `undefined` first and then the real value, while a client-side mount
  // reports the real value immediately, and both must count as a crossing.
  const isMobileViewport = useMediaQuery(MOBILE_MEDIA_QUERY, undefined);
  useOnValueChange(
    isMobileViewport,
    (isMobile) => {
      if (isMobile != null) {
        setDiffStyle(isMobile ? 'unified' : 'split');
        if (!isMobile) {
          setFileTreeOverlayOpen(false);
        }
      }
    },
    undefined
  );
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
  const handleToggleFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen((open) => !open);
  }, []);
  const handleCloseFileTreeOverlay = useCallback(() => {
    setFileTreeOverlayOpen(false);
  }, []);
  const handleSelectComment = useCallback(
    (entry: DiffsHubSavedCommentEntry) => {
      setFileTreeOverlayOpen(false);
      handleSelectTreeItem(entry.itemId);
      if (entry.comment.anchor.kind === 'file') return;
      const { range } = entry.comment.anchor;
      viewerRef.current?.setSelectedLines({ id: entry.itemId, range });
      viewerRef.current?.scrollTo({
        type: 'line',
        id: entry.itemId,
        lineNumber: range.end,
        side: range.endSide ?? range.side,
        align: 'center',
        behavior: 'smooth-auto',
      });
    },
    [handleSelectTreeItem]
  );
  // Withhold the viewer until the persisted themes have been read from
  // localStorage. Otherwise on client-side navigation back into a diff the
  // CodeView would mount during the brief render where lightThemeName/darkThemeName
  // are still at their `DEFAULT_*_THEME` initial values and tokenize the
  // first batch of files against the wrong palette.
  const viewerAvailable =
    isWorkerPoolReadyOrDisable &&
    themesHydrated &&
    (loadState === 'ready' ||
      (loadState === 'streaming' && initialItems.length > 0));

  return (
    <ReviewGrid>
      <DiffsHubHeader
        className="[grid-area:header]"
        collapseMode={collapseMode}
        colorMode={colorMode}
        darkThemeName={darkThemeName}
        diffIndicators={diffIndicators}
        diffStyle={diffStyle}
        initialUrl={initialUrl}
        lightThemeName={lightThemeName}
        lineNumbers={lineNumbers}
        overflow={overflow}
        fileTreeOverlayOpen={fileTreeOverlayOpen}
        fileTreeAvailable={treeSource != null}
        githubTokenActive={hasGitHubToken}
        onClearGitHubToken={clearGitHubToken}
        onSaveGitHubToken={setGitHubToken}
        onToggleCollapseMode={handleToggleCollapseMode}
        onToggleFileTreeOverlay={handleToggleFileTreeOverlay}
        setColorMode={setColorMode}
        setDarkThemeName={setDarkThemeName}
        setDiffIndicators={setDiffIndicators}
        setDiffStyle={setDiffStyle}
        setLightThemeName={setLightThemeName}
        setLineNumbers={setLineNumbers}
        setOverflow={setOverflow}
        setShowBackgrounds={setShowBackgrounds}
        showBackgrounds={showBackgrounds}
      />
      {viewerAvailable && treeSource != null ? (
        <>
          <DiffsHubSidebar
            className="[grid-area:viewer] md:[grid-area:tree]"
            commentSections={comments.sections}
            diffStats={diffStats}
            mobileOverlayOpen={fileTreeOverlayOpen}
            onMobileClose={handleCloseFileTreeOverlay}
            onSelectComment={handleSelectComment}
            scrollRef={scrollRef}
            source={treeSource}
            streaming={loadState === 'streaming'}
            themeCycle={themeCycle}
            viewerRef={viewerRef}
            onSelectItem={handleSelectTreeItem}
          />
          <DiffsHubViewer
            key={viewerKey}
            className="[grid-area:viewer]"
            diffStyle={diffStyle}
            overflow={overflow}
            showBackgrounds={showBackgrounds}
            diffIndicators={diffIndicators}
            lineNumbers={lineNumbers}
            scrollRef={scrollRef}
            themeType={colorMode}
            viewerRef={viewerRef}
            initialItems={initialItems}
            loadDiffFiles={loadDiffFiles}
            comments={comments}
            commentKind={commentKind}
            user={user}
            onLineLinkChange={onLineLinkChange}
            onViewerReady={handleViewerReady}
          />
        </>
      ) : (
        <DiffsHubStatusPanel
          errorMessage={errorMessage}
          onRetry={retryLoad}
          state={loadState}
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
