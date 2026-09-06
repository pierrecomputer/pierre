'use client';

import { type DiffIndicators } from '@pierre/diffs';
import { type CodeViewHandle, useWorkerPool } from '@pierre/diffs/react';
import { type ColorMode } from '@pierre/theming';
import { useThemeController } from '@pierre/theming/react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';

import { DiffsHubHeader } from './DiffsHubHeader';
import { DiffsHubSidebar } from './DiffsHubSidebar';
import { DiffsHubStatusPanel } from './DiffsHubStatusPanel';
import { DiffsHubViewer } from './DiffsHubViewer';
import { ThemeSourceProvider } from './ThemeSourceProvider';
import { useGitHubComments } from './useGitHubComments';
import { useGitHubToken } from './useGitHubToken';
import { useGitHubUser } from './useGitHubUser';
import { usePatchLoader } from './usePatchLoader';
import { useThemeCycle } from './useThemeCycle';
import {
  docsThemeCatalog,
  themeController,
} from '@/components/themeController';
import { preloadAvatars } from '@/lib/annotation';
import {
  type GitHubCommentWire,
  mapAnnotationSideToGitHub,
} from '@/lib/githubComments';
import {
  GitHubCommentPostError,
  postGitHubCommentRequest,
} from '@/lib/githubCommentsClient';
import { createGitHubDiffFileLoader } from '@/lib/githubDiffFileLoader';
import { parseGitHubDiffSource } from '@/lib/githubDiffSource';
import { removeSavedCommentSidebarEntry } from '@/lib/removeSavedCommentSidebarEntry';
import type { DarkThemeName, LightThemeName } from '@/lib/themeNames';
import type {
  CommentMetadata,
  DiffsHubDeletedCommentEvent,
  DiffsHubPostDraftRequest,
  DiffsHubPostReplyRequest,
  DiffsHubSavedCommentEntry,
} from '@/lib/types';
import { upsertSavedCommentSidebarEntry } from '@/lib/upsertSavedCommentSidebarEntry';

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
  useEffect(preloadAvatars, []);

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
    capability: githubTokenCapability,
    clearToken: clearGitHubToken,
    hasToken: hasGitHubToken,
    setToken: setGitHubToken,
    token: githubToken,
    tokenVersion: githubTokenVersion,
  } = useGitHubToken();
  const githubTokenRef = useRef(githubToken);
  const githubTokenVersionRef = useRef(githubTokenVersion);
  useEffect(() => {
    githubTokenRef.current = githubToken;
  }, [githubToken]);
  useEffect(() => {
    githubTokenVersionRef.current = githubTokenVersion;
  }, [githubTokenVersion]);
  const getGitHubToken = useCallback(() => githubTokenRef.current, []);
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
  // themeType) behind a client-mounted flag so the first client render matches
  // the SSR markup, then flips to the user's selection. This also keeps the
  // long-lived WorkerPool and the CodeView from mounting against the default
  // palette before the persisted values apply.
  const [themesHydrated, setThemesHydrated] = useState(false);
  useEffect(() => {
    setThemesHydrated(true);
  }, []);

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
  const loadDiffFiles = useMemo(
    () =>
      domain == null && hasGitHubToken
        ? createGitHubDiffFileLoader(path, {
            getAuthVersion: () => githubTokenVersionRef.current,
            getToken: () => githubTokenRef.current,
          })
        : undefined,
    [domain, hasGitHubToken, path]
  );
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
    getGitHubToken,
    githubTokenVersion,
    onLoadStart: handlePatchLoadStart,
    path,
    viewerRef,
  });
  // Real GitHub comments for the viewed source, fed into the same sidebar
  // sections local demo comments use. Fetches in parallel with the patch and
  // applies once the viewer is ready.
  const { payload: githubCommentsPayload } = useGitHubComments({
    commentFileByItemId,
    domain,
    getToken: getGitHubToken,
    loadState,
    path,
    setCommentSections,
    tokenVersion: githubTokenVersion,
    treeSource,
    viewerRef,
  });

  // The token owner's identity, shown on the comment form so posting reads
  // as "you", not a random persona.
  const githubUser = useGitHubUser({
    getToken: getGitHubToken,
    hasToken: hasGitHubToken,
    tokenVersion: githubTokenVersion,
  });

  // Posting is available only on pull sources with a write-declared token and
  // a known head sha (GitHub needs it as the commit_id of new comments).
  const githubDiffSource = useMemo(
    () => (domain == null ? parseGitHubDiffSource(path) : undefined),
    [domain, path]
  );
  const githubHeadSha = githubCommentsPayload?.headSha;
  const canPostGitHubComments =
    githubDiffSource?.kind === 'pull' &&
    hasGitHubToken &&
    githubTokenCapability === 'read-write' &&
    githubHeadSha != null;

  const handleGitHubPostError = useCallback((error: unknown) => {
    // 403 means no write access to THIS repo, which for fine-grained tokens
    // is usually resource-owner scoping (they can never write to repos
    // outside their owner), not a globally read-only token — so explain
    // rather than downgrading the stored capability. Rate limiting arrives
    // as 429, not 403.
    if (error instanceof GitHubCommentPostError && error.status === 403) {
      toast.error(
        "GitHub rejected the comment: this token has no write access to this repo. A fine-grained PAT must have the repo's owner (user or org) as its resource owner — or use a classic token with repo scope."
      );
      return;
    }
    toast.error(
      error instanceof Error ? error.message : 'Posting to GitHub failed.'
    );
  }, []);

  const postGitHubDraftComment = useCallback(
    async (request: DiffsHubPostDraftRequest): Promise<GitHubCommentWire> => {
      const token = githubTokenRef.current;
      const filePath = commentFileByItemId?.get(request.itemId)?.path;
      if (token == null || githubHeadSha == null || filePath == null) {
        const error = new Error('Missing GitHub posting context.');
        handleGitHubPostError(error);
        throw error;
      }
      try {
        return await postGitHubCommentRequest(path, token, {
          kind: 'comment',
          body: request.message,
          commitId: githubHeadSha,
          filePath,
          line: request.lineNumber,
          side: mapAnnotationSideToGitHub(request.side),
          ...(request.range.start !== request.range.end
            ? {
                startLine: request.range.start,
                startSide: mapAnnotationSideToGitHub(
                  request.range.side ?? request.side
                ),
              }
            : {}),
        });
      } catch (error) {
        handleGitHubPostError(error);
        throw error;
      }
    },
    [commentFileByItemId, githubHeadSha, handleGitHubPostError, path]
  );

  const postGitHubReply = useCallback(
    async ({ body, itemId, key, rootCommentId }: DiffsHubPostReplyRequest) => {
      const token = githubTokenRef.current;
      if (token == null) {
        const error = new Error('Missing GitHub posting context.');
        handleGitHubPostError(error);
        throw error;
      }
      let reply: GitHubCommentWire;
      try {
        reply = await postGitHubCommentRequest(path, token, {
          kind: 'reply',
          body,
          commentId: rootCommentId,
        });
      } catch (error) {
        handleGitHubPostError(error);
        throw error;
      }
      // Append the reply to the inline thread annotation…
      const viewer = viewerRef.current;
      const item = viewer?.getItem(itemId);
      if (viewer != null && item != null && item.type === 'diff') {
        item.annotations = (item.annotations ?? []).map((annotation) =>
          annotation.metadata.kind === 'github' &&
          annotation.metadata.key === key
            ? {
                ...annotation,
                metadata: {
                  ...annotation.metadata,
                  thread: {
                    root: annotation.metadata.thread.root,
                    replies: [...annotation.metadata.thread.replies, reply],
                  },
                },
              }
            : annotation
        );
        item.version = typeof item.version === 'number' ? item.version + 1 : 1;
        viewer.updateItem(item);
      }
      // …and mirror it into the sidebar entry.
      setCommentSections((previous) =>
        previous.map((section) =>
          section.itemId !== itemId
            ? section
            : {
                ...section,
                comments: section.comments.map((comment) =>
                  comment.key !== key
                    ? comment
                    : {
                        ...comment,
                        replyCount: (comment.replyCount ?? 0) + 1,
                        thread:
                          comment.thread == null
                            ? undefined
                            : {
                                root: comment.thread.root,
                                replies: [...comment.thread.replies, reply],
                              },
                      }
                ),
              }
        )
      );
    },
    [handleGitHubPostError, path, setCommentSections]
  );

  const draftHint =
    githubDiffSource?.kind === 'pull'
      ? canPostGitHubComments
        ? 'Posts to the pull request on GitHub.'
        : 'Saved locally only — add a GitHub token with write access to post.'
      : undefined;

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
    (comment: DiffsHubSavedCommentEntry) => {
      setCommentSections((prev) =>
        upsertSavedCommentSidebarEntry(prev, commentFileByItemId, comment)
      );
    },
    [commentFileByItemId, setCommentSections]
  );
  const handleCommentDeleted = useCallback(
    (comment: DiffsHubDeletedCommentEvent) => {
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
    (comment: DiffsHubSavedCommentEntry) => {
      setFileTreeOverlayOpen(false);
      // File-level and outdated comments have no selectable lines in the
      // current diff; jump to the file instead.
      if (comment.anchor != null) {
        viewerRef.current?.scrollTo({
          type: 'item',
          id: comment.itemId,
          align: 'start',
          behavior: 'smooth-auto',
        });
        return;
      }
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
        githubRepoOwner={githubDiffSource?.repo.owner}
        githubTokenActive={hasGitHubToken}
        githubTokenCapability={githubTokenCapability}
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
            commentsPostToGitHub={canPostGitHubComments}
            commentSections={commentSections}
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
            draftAuthor={canPostGitHubComments ? githubUser : undefined}
            draftHint={draftHint}
            onCommentDeleted={handleCommentDeleted}
            onCommentSaved={handleCommentSaved}
            onLineLinkChange={onLineLinkChange}
            onViewerReady={onViewerReady}
            postComment={
              canPostGitHubComments ? postGitHubDraftComment : undefined
            }
            postReply={canPostGitHubComments ? postGitHubReply : undefined}
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
