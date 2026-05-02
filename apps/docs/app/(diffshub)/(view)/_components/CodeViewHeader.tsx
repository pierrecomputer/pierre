import { type CodeViewItem, parsePatchFiles } from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import {
  IconArrow,
  IconCodeStyleBars,
  IconDiffSplit,
  IconDiffUnified,
  IconEyeSlash,
  IconFileTreeFill,
  IconGearFill,
  IconSymbolDiffstat,
} from '@pierre/icons';
import type { GitStatusEntry } from '@pierre/trees';
import Link from 'next/link';
import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { DiffsHubLogo } from './DiffsHubLogo';
import { getCachedPatchText, setCachedPatchText } from './patchCache';
import type {
  CodeViewCommentFileByItemId,
  CodeViewCommentSidebarFile,
  CodeViewFileTreeSource,
  CodeViewSavedCommentItem,
  CommentMetadata,
} from './types';
import {
  createCodeViewFileTreeSource,
  getPullRequestPath,
  mapChangeTypeToGitStatus,
} from './utils';
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

const COMMIT_HASH_METADATA_PATTERN = /^From\s+([a-f0-9]+)\s/im;
const INITIAL_COLLAPSED_DIFF_LINE_THRESHOLD = 200_000;

/** Full-row hit target: native label activates the nested switch when the caption is clicked. */
const VIEW_OPTION_LABEL_CLASS =
  'w-full flex cursor-pointer items-center justify-between gap-4 px-2 py-1.5 text-sm';

function getPatchTreePathPrefix(
  patchMetadata: string | undefined,
  patchIndex: number
): string {
  const commitHash = patchMetadata?.match(COMMIT_HASH_METADATA_PATTERN)?.[1];
  return commitHash != null
    ? commitHash.slice(0, 5)
    : `Commit ${patchIndex + 1}`;
}

interface HeaderProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  fileTreeAvailable: boolean;
  fileTreeOverlayOpen: boolean;
  initialUrl: string;
  onToggleFileTreeOverlay(): void;
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  setCommentSections: Dispatch<SetStateAction<CodeViewSavedCommentItem[]>>;
  setCommentFileByItemId: Dispatch<
    SetStateAction<CodeViewCommentFileByItemId | null>
  >;
  setItems: Dispatch<SetStateAction<CodeViewItem<CommentMetadata>[]>>;
  setTreeSource: Dispatch<SetStateAction<CodeViewFileTreeSource | null>>;
  overflow: 'wrap' | 'scroll';
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  setKey: Dispatch<SetStateAction<number>>;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

export const CodeViewHeader = memo(function CodeViewHeader({
  className,
  diffStyle,
  fileTreeAvailable,
  fileTreeOverlayOpen,
  initialUrl,
  onToggleFileTreeOverlay,
  overflow,
  setCommentSections,
  setCommentFileByItemId,
  setItems,
  setOverflow,
  setDiffStyle,
  setKey,
  setTreeSource,
}: HeaderProps) {
  const hasFetched = useRef(false);
  /** Placeholder toggles for the settings menu; not wired to the viewer yet. */
  const [showBackgrounds, setShowBackgrounds] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [indicatorStyle, setIndicatorStyle] = useState<
    'bars' | 'classic' | 'none'
  >('bars');
  const lastLoadedURLRef = useRef<string | null>(null);
  const [url, setURL] = useState(initialUrl);
  /** Radix `align` is not CSS-breakpoint aware; mirror Tailwind `md` (768px). */
  const [viewOptionsMenuAlign, setViewOptionsMenuAlign] = useState<
    'start' | 'end'
  >('start');
  useLayoutEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => setViewOptionsMenuAlign(media.matches ? 'end' : 'start');
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const renderPullRequest = useStableCallback(async (input: string) => {
    const normalizedURL = input.trim();
    const prPath = getPullRequestPath(normalizedURL);
    if (prPath == null) {
      console.error('Invalid URL', normalizedURL);
      return undefined;
    }

    lastLoadedURLRef.current = normalizedURL;

    try {
      let patchContent = getCachedPatchText(prPath);
      if (patchContent == null) {
        console.time('--     request time');
        const response = await fetch(
          `/api/fetch-pr-patch?path=${encodeURIComponent(prPath)}`
        );
        console.timeEnd('--     request time');

        if (!response.ok) {
          const error = await response.text();
          console.error('Failed to fetch patch:', error);
          return undefined;
        }

        console.time('--     reading patch');
        patchContent = await response.text();
        console.timeEnd('--     reading patch');
        setCachedPatchText(prPath, patchContent);
      }

      console.time('--  parsing patches');
      const parsedPatches = parsePatchFiles(
        patchContent,
        // Use the url as a cache key
        encodeURIComponent(prPath)
      );
      console.timeEnd('--  parsing patches');

      console.time('-- computing layout');
      let fileIndex = 0;
      const items: CodeViewItem<CommentMetadata>[] = [];
      // Build the tree's path list, id map, and git-status entries in the
      // same pass that constructs items so large patches (thousands of files)
      // do not pay for a second walk when we finalize the tree source below.
      const paths: string[] = [];
      const pathToItemId = new Map<string, string>();
      const itemIdToFile = new Map<string, CodeViewCommentSidebarFile>();
      const gitStatus: GitStatusEntry[] = [];
      for (const [patchIndex, patch] of parsedPatches.entries()) {
        const treePathPrefix = getPatchTreePathPrefix(
          patch.patchMetadata,
          patchIndex
        );
        for (const fileDiff of patch.files) {
          const id = `${fileIndex++}:${fileDiff.name}`;
          const fileOrder = items.length;

          items.push({
            id,
            type: 'diff',
            collapsed:
              fileDiff.type === 'deleted' ||
              Math.max(fileDiff.splitLineCount, fileDiff.unifiedLineCount) >
                INITIAL_COLLAPSED_DIFF_LINE_THRESHOLD,
            fileDiff,
            version: 0,
          });

          const path = fileDiff.name;
          itemIdToFile.set(id, { fileOrder, path });
          const treePath = `${treePathPrefix}/${path}`;
          if (path.length === 0 || pathToItemId.has(treePath)) {
            continue;
          }
          paths.push(treePath);
          pathToItemId.set(treePath, id);
          gitStatus.push({
            path: treePath,
            status: mapChangeTypeToGitStatus(fileDiff.type),
          });
        }
      }
      // Don't key on the first fetch... for testing purposes
      if (hasFetched.current) {
        setKey((value) => ++value);
      } else {
        hasFetched.current = true;
      }
      // Pre-compute the stable tree source here so later annotation-driven
      // items updates never feed back into the file tree component.
      setTreeSource(
        createCodeViewFileTreeSource(paths, pathToItemId, gitStatus)
      );
      setCommentFileByItemId(itemIdToFile);
      setCommentSections([]);
      setItems(items);
      console.timeEnd('-- computing layout');
      // DEBUG AREA
      // window.scrollTo({ top: 4762353 });
      // queueRender(() => {
      //   window.scrollTo({ top: 3150238.5 });
      // });

      return normalizedURL;
    } catch (error) {
      console.error('Error fetching or processing patch:', error);
      return undefined;
    }
  });
  const handleSubmit = useStableCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedURL = await renderPullRequest(url);
      if (normalizedURL == null) {
        return;
      }
      setURL(normalizedURL);
    }
  );
  // Auto-fetch the PR the user came in with. The page-level server component
  // has already validated `initialUrl` via `getPullRequestPath`, so we trust
  // it and fire once on mount. `renderPullRequest` is stable (useStableCallback)
  // and its `hasFetched` ref guards against the first fetch bumping the viewer
  // key, matching the behavior we had before this prop existed.
  useEffect(() => {
    void renderPullRequest(initialUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      className={cn(
        'z-10 m-2 mb-0 contain-layout contain-paint flex flex-wrap md:flex-nowrap border-border bg-background items-center gap-2.5 rounded-xl border p-3 md:py-2 shadow-xs',
        className
      )}
    >
      <Link
        href="/"
        className="absolute top-3 left-[50%] inline-flex -translate-x-1/2 transition-transform duration-200 hover:scale-110 md:static md:translate-x-0"
      >
        <DiffsHubLogo />
      </Link>
      <span className="text-md hidden text-neutral-300 md:-mr-2 md:inline-flex">
        /
      </span>
      <form
        className="order-last flex w-full flex-col gap-2 md:order-none md:flex-row md:gap-2"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit}
      >
        <input
          className="text-md focus:bg-accent block h-8 w-full min-w-[220px] rounded-md px-2 text-center focus-visible:outline-none md:h-9 md:text-left"
          value={url}
          onChange={({ currentTarget }) => setURL(currentTarget.value)}
          placeholder="e.g. https://github.com/twbs/bootstrap/pull/42139"
        />
        <Button
          type="submit"
          variant="default"
          size="icon"
          className="hidden md:flex"
          aria-label="Submit"
        >
          <IconArrow className="size-4 rotate-180" />
        </Button>
      </form>
      <div className="bg-border mx-1 hidden h-5 w-px md:block" />
      <div className="flex w-full items-center gap-2 md:w-auto">
        <Button
          type="button"
          variant="muted"
          size="icon"
          aria-pressed={fileTreeOverlayOpen}
          disabled={!fileTreeAvailable}
          title={fileTreeOverlayOpen ? 'Hide file tree' : 'Show file tree'}
          className="border-border/80 shrink-0 rounded-lg md:hidden"
          onClick={onToggleFileTreeOverlay}
        >
          <IconFileTreeFill className="size-4" />
        </Button>
        <ButtonGroup
          className="ml-auto hidden md:flex"
          value={diffStyle}
          onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
        >
          <ButtonGroupItem value="split" className="size-9 p-0">
            <IconDiffSplit className="size-4" />
            <span className="sr-only">Split view</span>
          </ButtonGroupItem>
          <ButtonGroupItem value="unified" className="size-9 p-0">
            <IconDiffUnified className="size-4" />
            <span className="sr-only">Unified view</span>
          </ButtonGroupItem>
        </ButtonGroup>
        <DropdownMenu open={viewOptionsOpen} onOpenChange={setViewOptionsOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant={viewOptionsOpen ? 'outline' : 'muted'}
              size="icon"
              title="View options"
              className="rounded-lg"
            >
              <IconGearFill className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={viewOptionsMenuAlign} className="w-56">
            <DropdownMenuItem
              className="cursor-default p-0"
              onSelect={(event) => event.preventDefault()}
            >
              <label className={VIEW_OPTION_LABEL_CLASS}>
                <span className="min-w-0 flex-1">Backgrounds</span>
                <Switch
                  checked={showBackgrounds}
                  onCheckedChange={setShowBackgrounds}
                />
              </label>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-default p-0"
              onSelect={(event) => event.preventDefault()}
            >
              <label className={VIEW_OPTION_LABEL_CLASS}>
                <span className="min-w-0 flex-1">Line numbers</span>
                <Switch
                  checked={lineNumbers}
                  onCheckedChange={setLineNumbers}
                />
              </label>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-default p-0"
              onSelect={(event) => event.preventDefault()}
            >
              <label className={VIEW_OPTION_LABEL_CLASS}>
                <span className="min-w-0 flex-1">Word wrap</span>
                <Switch
                  checked={overflow === 'wrap'}
                  onCheckedChange={(checked) =>
                    setOverflow(checked ? 'wrap' : 'scroll')
                  }
                  className="shrink-0"
                />
              </label>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="w-full px-2 focus:bg-transparent md:hidden"
              onSelect={(event) => event.preventDefault()}
            >
              <span>Diff layout</span>
              <ButtonGroup
                className="ml-auto"
                value={diffStyle}
                onValueChange={(value) =>
                  setDiffStyle(value as 'split' | 'unified')
                }
              >
                <ButtonGroupItem value="split" className="size-7 p-0">
                  <IconDiffSplit className="size-4" />
                  <span className="sr-only">Split view</span>
                </ButtonGroupItem>
                <ButtonGroupItem value="unified" className="size-7 p-0">
                  <IconDiffUnified className="size-4" />
                  <span className="sr-only">Unified view</span>
                </ButtonGroupItem>
              </ButtonGroup>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="w-full px-2 focus:bg-transparent"
              onSelect={(event) => event.preventDefault()}
            >
              <span>Indicator style</span>
              <ButtonGroup
                className="ml-auto"
                value={indicatorStyle}
                onValueChange={(value) =>
                  setIndicatorStyle(value as 'bars' | 'classic' | 'none')
                }
              >
                <ButtonGroupItem value="bars" className="size-7 p-0">
                  <IconCodeStyleBars size="12" />
                </ButtonGroupItem>
                <ButtonGroupItem value="classic" className="size-7 p-0">
                  <IconSymbolDiffstat size="12" />
                </ButtonGroupItem>
                <ButtonGroupItem value="none" className="size-7 p-0">
                  <IconEyeSlash size="12" />
                </ButtonGroupItem>
              </ButtonGroup>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <hr className="border-border/80 w-full md:hidden" />
    </div>
  );
});
