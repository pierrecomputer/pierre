'use client';

import {
  type CodeViewer as CodeViewerClass,
  type CodeViewerItem,
  type CodeViewerOptions,
  DEFAULT_THEMES,
  DEFAULT_VIRTUAL_FILE_METRICS,
  type DiffLineAnnotation,
  parsePatchFiles,
} from '@pierre/diffs';
import {
  CodeViewer,
  type LineAnnotation,
  useStableCallback,
} from '@pierre/diffs/react';
import {
  IconDiffSplit,
  IconDiffUnified,
  IconParagraph,
  IconWordWrap,
} from '@pierre/icons';
import {
  createContext,
  type Dispatch,
  memo,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import styles from './advanced-diff.module.css';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { Button } from '@/components/ui/button';

const ExampleContext = createContext(0);

interface ExampleAnnotationProps {
  annotation: DiffLineAnnotation<CommentMetadata>;
}

export function ExampleAnnotation({ annotation }: ExampleAnnotationProps) {
  const value = useContext(ExampleContext);
  return (
    <div
      style={{
        margin: 8,
        padding: 8,
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        background: 'var(--color-muted)',
        overflow: 'hidden',
        maxWidth: 600,
      }}
    >
      <strong style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>
        {annotation.metadata.author}, with context value of: {value}
      </strong>
      <p style={{ margin: 0, fontSize: 13, whiteSpace: 'normal' }}>
        {annotation.metadata.message}
      </p>
    </div>
  );
}

interface CommentMetadata {
  author: string;
  message: string;
}

export function renderAnnotation(
  annotation:
    | DiffLineAnnotation<CommentMetadata>
    | LineAnnotation<CommentMetadata>
): ReactNode {
  if (!('side' in annotation)) {
    return null;
  }
  return <ExampleAnnotation annotation={annotation} />;
}

const unsafeCSS = `[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: var(--diffs-bg);
}
@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}`;

const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';

function getPullRequestPath(input: string): string | undefined {
  try {
    const parsedURL = new URL(input);
    if (parsedURL.hostname !== 'github.com') {
      return undefined;
    }
    const [finalSegment, pullSegment] = parsedURL.pathname.split('/').reverse();
    if (
      finalSegment == null ||
      !/^\d+(\.patch)?$/.test(finalSegment) ||
      pullSegment !== 'pull'
    ) {
      return undefined;
    }
    return parsedURL.pathname;
  } catch {
    return undefined;
  }
}

const VIEWER_METRICS = { gap: 12, paddingBottom: 20, paddingTop: 1 };

export function AdvancedDiff() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [key, setKey] = useState(0);
  const [items, setItems] = useState<CodeViewerItem<CommentMetadata>[]>([]);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <ExampleContext.Provider value={10}>
        <Header
          diffStyle={diffStyle}
          overflow={overflow}
          setItems={setItems}
          setOverflow={setOverflow}
          setDiffStyle={setDiffStyle}
          setKey={setKey}
        />
        <CodeViewerWrapper
          key={key}
          diffStyle={diffStyle}
          overflow={overflow}
          scrollRef={scrollRef}
          items={items}
        />
        <WorkerPoolStatus scrollRef={scrollRef} />
      </ExampleContext.Provider>
    </>
  );
}

interface CodeViewerWrapperProps {
  diffStyle: 'split' | 'unified';
  overflow: 'wrap' | 'scroll';
  scrollRef: RefObject<HTMLDivElement | null>;
  items: CodeViewerItem<CommentMetadata>[];
}

const CodeViewerWrapper = memo(function CodeViewerWrapper({
  diffStyle,
  overflow,
  scrollRef,
  items,
}: CodeViewerWrapperProps) {
  const isScrolledRef = useRef(false);
  const handleScroll = useStableCallback(
    (scrollTop: number, viewer: CodeViewerClass<CommentMetadata>) => {
      const container = viewer.getContainerElement();
      if (container == null) {
        return;
      }

      if (scrollTop > 0 && !isScrolledRef.current) {
        container.setAttribute('data-scrolled', '');
        isScrolledRef.current = true;
      } else if (scrollTop === 0 && isScrolledRef.current) {
        container.removeAttribute('data-scrolled');
        isScrolledRef.current = false;
      }
    }
  );
  // NOTE(amadeus): For some insane reason, the react compiler did not know how
  // to properly memoize this, so we pulled it into a `useMemo` for safety...
  const options: CodeViewerOptions<CommentMetadata> = useMemo(
    () => ({
      theme: DEFAULT_THEMES,
      diffStyle,
      overflow,
      // hunkSeparators: 'line-info-basic',
      // FIXME(amadeus): We need to optimize this...
      enableLineSelection: true,
      enableGutterUtility: true,
      unsafeCSS,
      onLineSelected(range, context) {
        console.log('Selected', range, context.item.id);
      },
    }),
    [diffStyle, overflow]
  );
  return (
    <CodeViewer<CommentMetadata>
      containerRef={scrollRef}
      items={items}
      className={styles.scrollContainer}
      viewerMetrics={VIEWER_METRICS}
      options={options}
      onScroll={handleScroll}
      // To test annotations and headers and stuff...
      renderAnnotation={renderAnnotation}
      // metrics={CUSTOM_HEADER_METRICS}
      // renderCustomHeader={renderHeader}
    />
  );
});

export const CUSTOM_HEADER_METRICS = {
  ...DEFAULT_VIRTUAL_FILE_METRICS,
  diffHeaderHeight: 20,
};

export function renderHeader(item: CodeViewerItem<CommentMetadata>) {
  if (item.type === 'diff') {
    return <div>{item.fileDiff.name}</div>;
  }
  return null;
}

interface HeaderProps {
  diffStyle: 'split' | 'unified';
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  setItems: Dispatch<SetStateAction<CodeViewerItem<CommentMetadata>[]>>;
  overflow: 'wrap' | 'scroll';
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  setKey: Dispatch<SetStateAction<number>>;
}

const Header = memo(function Header({
  diffStyle,
  overflow,
  setItems,
  setOverflow,
  setDiffStyle,
  setKey,
}: HeaderProps) {
  const hasFetched = useRef(false);
  const [fetching, setFetching] = useState(false);
  const lastLoadedURLRef = useRef<string | null>(null);
  const [url, setURL] = useState(DEFAULT_PR_URL);
  const renderPullRequest = useStableCallback(async (input: string) => {
    const normalizedURL = input.trim();
    const prPath = getPullRequestPath(normalizedURL);
    if (prPath == null) {
      console.error('Invalid URL', normalizedURL);
      return undefined;
    }

    setFetching(true);
    lastLoadedURLRef.current = normalizedURL;

    try {
      console.time('--     request time');
      const response = await fetch(
        `/api/fetch-pr-patch?path=${encodeURIComponent(prPath)}`
      );
      console.timeEnd('--     request time');

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to fetch patch:', error);
        return undefined;
      }

      console.time('--     parsing json');
      const data = await response.json();
      console.timeEnd('--     parsing json');

      console.time('--  parsing patches');
      const parsedPatches = parsePatchFiles(
        data.content,
        // Use the url as a cache key
        encodeURIComponent(prPath)
      );
      console.timeEnd('--  parsing patches');

      console.time('-- computing layout');
      let fileIndex = 0;
      const items: CodeViewerItem<CommentMetadata>[] = [];
      for (const patch of parsedPatches) {
        for (const fileDiff of patch.files) {
          const id = `${fileIndex++}`;
          const annotations: DiffLineAnnotation<CommentMetadata>[] = [];

          // Add fake annotations to the first 3 files, using actual
          // line numbers from the first hunk so they land on visible lines
          const firstHunk = fileDiff.hunks[0];
          if (fileIndex <= 3 && firstHunk != null) {
            annotations.push({
              side: 'additions',
              lineNumber: firstHunk.additionStart,
              metadata: {
                author: 'reviewerbot',
                message: `This is a demo annotation on file #${fileIndex} (additions L${firstHunk.additionStart})`,
              },
            });
            annotations.push({
              side: 'deletions',
              lineNumber: firstHunk.deletionStart,
              metadata: {
                author: 'nitpicker42',
                message: `Why was this line changed? Looks fine to me.`,
              },
            });
          }
          items.push({
            id,
            type: 'diff',
            fileDiff,
            annotations: annotations.length > 0 ? annotations : undefined,
          });
        }
      }
      // Don't key on the first fetch... for testing purposes
      if (hasFetched.current) {
        setKey((value) => ++value);
      } else {
        hasFetched.current = true;
      }
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
    } finally {
      setFetching(false);
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
  return (
    <div className="bg-muted mx-5 mb-5 max-w-full rounded-lg p-2">
      <form
        className="flex w-full flex-col gap-2 md:flex-row md:gap-2"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit}
      >
        <div className="bg-background focus-within:ring-ring flex w-full flex-col items-start rounded-md border-1 px-3 py-3 focus-within:ring-2 focus-within:ring-offset-[-1px] md:flex-row md:items-center md:gap-2 md:py-1">
          <label className="text-muted-foreground block text-sm text-nowrap">
            GitHub URL
          </label>
          <input
            className="block w-full text-sm focus-visible:outline-none"
            value={url}
            onChange={({ currentTarget }) => setURL(currentTarget.value)}
            placeholder="e.g. https://github.com/twbs/bootstrap/pull/42139"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-pressed={diffStyle === 'split'}
          title={
            diffStyle === 'split'
              ? 'Switch to unified view'
              : 'Switch to split view'
          }
          className="border-border/80 rounded-lg"
          onClick={() =>
            setDiffStyle((currentStyle) =>
              currentStyle === 'split' ? 'unified' : 'split'
            )
          }
        >
          {diffStyle === 'split' ? (
            <IconDiffSplit className="size-4" />
          ) : (
            <IconDiffUnified className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-pressed={overflow === 'wrap'}
          title={overflow === 'wrap' ? 'Disable wrapping' : 'Enable wrapping'}
          className="border-border/80 rounded-lg"
          onClick={() =>
            setOverflow((currentOverflow) =>
              currentOverflow === 'wrap' ? 'scroll' : 'wrap'
            )
          }
        >
          {overflow === 'wrap' ? (
            <IconWordWrap className="size-4" />
          ) : (
            <IconParagraph className="size-4" />
          )}
        </Button>
        <Button type="submit" disabled={fetching}>
          {fetching ? 'Fetching…' : 'Render Diff'}
        </Button>
      </form>
    </div>
  );
});
