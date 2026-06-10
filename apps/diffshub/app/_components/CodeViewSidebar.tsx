'use client';

import {
  IconComment,
  IconFileTree,
  IconSearch,
  IconXSquircle,
} from '@pierre/icons';
import { FileTree } from '@pierre/trees';
import { useFileTreeSearch } from '@pierre/trees/react';
import {
  type CSSProperties,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useState,
} from 'react';

import { diffshubChromeMapping } from './_theming/js/diffshubChromeMapping';
import { useChromeThemeProps } from './_theming/react/useChromeThemeProps';
import { CodeViewCommentsList } from './CodeViewCommentsList';
import { CodeViewDiffStats } from './CodeViewDiffStats';
import { CodeViewFileTree } from './CodeViewFileTree';
import type {
  CodeViewDiffStats as CodeViewDiffStatsData,
  CodeViewFileTreeSource,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentItem,
} from './types';
import type { ThemeCycleControls } from './useThemeCycle';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { cn } from '@/lib/utils';

type SidebarTab = 'files' | 'comments';
type SidebarStatusPanel = 'diffStats' | 'systemMonitor';

const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

interface CodeViewSidebarProps {
  className?: string;
  commentSections: readonly CodeViewSavedCommentItem[];
  diffStats: CodeViewDiffStatsData | null;
  mobileOverlayOpen?: boolean;
  onMobileClose(): void;
  onSelectComment(comment: CodeViewSavedCommentEntry): void;
  onSelectItem(itemId: string): void;
  scrollRef: RefObject<HTMLDivElement | null>;
  source: CodeViewFileTreeSource;
  streaming: boolean;
  themeCycle: ThemeCycleControls;
}

export const CodeViewSidebar = memo(function CodeViewSidebar({
  className,
  commentSections,
  diffStats,
  mobileOverlayOpen = false,
  onMobileClose,
  onSelectComment,
  onSelectItem,
  scrollRef,
  source,
  streaming,
  themeCycle,
}: CodeViewSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('files');
  let totalCommentCount = 0;
  for (const section of commentSections) {
    totalCommentCount += section.comments.length;
  }
  // Pull the resolved Shiki theme so the whole sidebar (tabs row, file
  // tree, diff stats panel, footer) sits on the theme's sidebar surface
  // and its chrome text follows the theme's own foreground tokens
  // instead of an opacity-derived fade of the file-tree's muted text.
  // Shared with the header so both chrome surfaces stay in sync.
  const { style: sidebarChromeStyle } = useChromeThemeProps(
    diffshubChromeMapping
  );
  const sidebarStyle =
    Object.keys(sidebarChromeStyle).length > 0 ? sidebarChromeStyle : undefined;
  const [activeStatusPanel, setActiveStatusPanel] =
    useState<SidebarStatusPanel | null>('diffStats');
  const [fileTreeModel, setFileTreeModel] = useState<FileTree | null>(null);
  const handleModelReady = useCallback((model: FileTree | null) => {
    setFileTreeModel(model);
  }, []);
  const toggleStatusPanel = useCallback((panel: SidebarStatusPanel) => {
    setActiveStatusPanel((current) => (current === panel ? null : panel));
  }, []);

  useEffect(() => {
    if (mobileOverlayOpen && window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      setActiveStatusPanel(null);
    }
  }, [mobileOverlayOpen]);

  useEffect(() => {
    if (!mobileOverlayOpen || !window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
      return undefined;
    }

    const { body, documentElement } = document;
    const codeViewScroll = scrollRef.current;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverscrollBehavior =
      documentElement.style.overscrollBehavior;
    const previousCodeViewOverflow = codeViewScroll?.style.overflow;

    body.style.overflow = 'hidden';
    documentElement.style.overscrollBehavior = 'none';
    if (codeViewScroll != null) {
      codeViewScroll.style.overflow = 'hidden';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overscrollBehavior = previousRootOverscrollBehavior;
      if (codeViewScroll != null) {
        codeViewScroll.style.overflow = previousCodeViewOverflow ?? '';
      }
    };
  }, [mobileOverlayOpen, scrollRef]);

  return (
    <>
      <button
        type="button"
        aria-hidden={!mobileOverlayOpen}
        aria-label="Close file tree"
        tabIndex={mobileOverlayOpen ? 0 : -1}
        className={cn(
          'z-20 cursor-default bg-background/60 backdrop-blur-xs transition-opacity [grid-column:1/-1] [grid-row:1/-1] md:hidden',
          mobileOverlayOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
        onClick={onMobileClose}
      />
      <SidebarWrapper
        className={className}
        mobileOverlayOpen={mobileOverlayOpen}
        themeStyle={sidebarStyle}
      >
        <div className="flex items-center gap-3 px-4 pt-5 pb-2 md:px-3 md:pt-0.5 md:pb-0">
          <ButtonGroup
            aria-label="Sidebar sections"
            className="mr-auto flex min-w-0 gap-3 bg-transparent md:gap-2"
            variant="ghost"
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as SidebarTab)}
          >
            <ButtonGroupItem
              value="files"
              size="icon-only"
              className="shadow-none"
            >
              <IconFileTree className="size-4 md:size-3" />
              <span className="sr-only">Files</span>
            </ButtonGroupItem>
            <ButtonGroupItem
              value="comments"
              size="icon-only"
              className={cn(
                'shadow-none',
                totalCommentCount > 0 && 'w-auto gap-1 pr-1'
              )}
            >
              <IconComment className="size-4 md:size-3" />
              <span className="sr-only">Comments</span>
              {totalCommentCount > 0 && (
                <span
                  aria-hidden="true"
                  // Tint the badge with the chrome's current text color so
                  // it follows the active Shiki theme instead of staying
                  // on hardcoded neutral grays. `currentColor` resolves to
                  // whichever fg the button inherits (chrome primaryFg
                  // for the unselected ghost variant, accent-foreground
                  // when this tab is selected), so the pill stays
                  // on-palette in both states.
                  className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[color-mix(in_srgb,currentColor_18%,transparent)] px-1 text-[10px] leading-none font-medium tabular-nums"
                >
                  {totalCommentCount}
                </span>
              )}
            </ButtonGroupItem>
          </ButtonGroup>
          {activeTab === 'files' && fileTreeModel != null && (
            <FileTreeSearchToggle model={fileTreeModel} />
          )}
          {onMobileClose != null && (
            <Button
              variant="ghost"
              size="icon-only"
              className="md:hidden"
              aria-label="Close file tree"
              onClick={onMobileClose}
            >
              <IconXSquircle className="size-4 md:size-3" />
            </Button>
          )}
        </div>
        <div className="mt-3 min-h-0 flex-1">
          <div
            role="region"
            aria-label="Files"
            hidden={activeTab !== 'files'}
            className="h-full min-h-0"
          >
            <CodeViewFileTree
              source={source}
              onModelReady={handleModelReady}
              onSelectItem={onSelectItem}
            />
          </div>
          <div
            role="region"
            aria-label="Comments"
            hidden={activeTab !== 'comments'}
            className="h-full min-h-0"
          >
            <CodeViewCommentsList
              commentSections={commentSections}
              onSelectComment={onSelectComment}
              onSelectItem={onSelectItem}
            />
          </div>
        </div>
        <CodeViewDiffStats
          expanded={activeStatusPanel === 'diffStats'}
          onToggle={() => toggleStatusPanel('diffStats')}
          stats={diffStats}
          streaming={streaming}
        />
        <WorkerPoolStatus
          expanded={activeStatusPanel === 'systemMonitor'}
          onToggle={() => toggleStatusPanel('systemMonitor')}
          scrollRef={scrollRef}
          themeCycle={themeCycle}
        />
      </SidebarWrapper>
    </>
  );
});

interface SidebarWrapperProps {
  children: ReactNode;
  className?: string;
  mobileOverlayOpen: boolean;
  themeStyle?: CSSProperties;
}

function SidebarWrapper({
  children,
  className,
  mobileOverlayOpen,
  themeStyle,
}: SidebarWrapperProps) {
  return (
    <div
      className={cn(
        className,
        'contain-strict z-30 flex h-full min-h-0 flex-col transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none md:z-auto md:translate-y-0 md:will-change-auto',
        // Fall back to the neutral diffshub chrome background when no Shiki
        // theme bg is available yet (initial render before the resolver
        // returns).
        themeStyle == null && 'bg-[var(--diffshub-sidebar-bg)]',
        mobileOverlayOpen
          ? 'pointer-events-auto translate-y-0 overflow-hidden rounded-t-xl shadow-[0_0_0_1px_var(--color-border-opaque),_0_16px_32px_rgb(0_0_0_/0.25)] md:h-full md:overflow-visible md:rounded-none md:border-0 md:shadow-none'
          : 'pointer-events-none translate-y-[calc(100%+1.5rem)] overflow-hidden rounded-xl md:pointer-events-auto md:h-full md:overflow-visible md:rounded-none pt-3 border-r border-[var(--color-border-opaque)]'
      )}
      style={themeStyle}
    >
      {children}
    </div>
  );
}

// Lives in its own component so we can call useFileTreeSearch only once we
// actually have a model; conditional hook calls aren't allowed in the parent.
function FileTreeSearchToggle({ model }: { model: FileTree }) {
  const search = useFileTreeSearch(model);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-only"
      aria-label={search.isOpen ? 'Hide file search' : 'Show file search'}
      aria-pressed={search.isOpen}
      // Avoid focus moving to this button before click: the tree search input
      // closes on blur, so without preventDefault the blur runs first, then
      // click sees isOpen false and calls open() again.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        if (search.isOpen) {
          search.close();
        } else {
          search.open();
        }
      }}
    >
      <IconSearch className="size-4 md:size-3" />
    </Button>
  );
}
