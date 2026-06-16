'use client';

import {
  IconComment,
  IconFileTree,
  IconFilter,
  IconSearch,
  IconXSquircle,
} from '@pierre/icons';
import { FileTree } from '@pierre/trees';
import type { GitStatus } from '@pierre/trees';
import { useFileTreeSearch } from '@pierre/trees/react';
import {
  type CSSProperties,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CHROME_ICON_BUTTON_CLASS } from './chromeButtonStyles';
import { DiffsHubCommentsList } from './DiffsHubCommentsList';
import { DiffsHubDiffStats } from './DiffsHubDiffStats';
import { DiffsHubFileTree } from './DiffsHubFileTree';
import { useChromeThemeProps } from './useChromeThemeProps';
import type { ThemeCycleControls } from './useThemeCycle';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { Button } from '@/components/Button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ButtonGroup';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/DropdownMenu';
import { cn } from '@/lib/cn';
import { filterDiffsHubFileTreeSource } from '@/lib/filterDiffsHubFileTreeSource';
import { getDiffsHubFileTreeAvailableStatuses } from '@/lib/getDiffsHubFileTreeAvailableStatuses';
import { diffshubChromeMapping } from '@/lib/theme/diffshubChromeMapping';
import { getDropdownThemeStyle } from '@/lib/theme/dropdownChromeStyle';
import type {
  DiffsHubDiffStats as DiffsHubDiffStatsData,
  DiffsHubFileTreeSource,
  DiffsHubSavedCommentEntry,
  DiffsHubSavedCommentItem,
} from '@/lib/types';

type SidebarTab = 'files' | 'comments';
type SidebarStatusPanel = 'diffStats' | 'systemMonitor';

const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

interface DiffsHubSidebarProps {
  className?: string;
  commentSections: readonly DiffsHubSavedCommentItem[];
  diffStats: DiffsHubDiffStatsData | null;
  mobileOverlayOpen?: boolean;
  onMobileClose(): void;
  onSelectComment(comment: DiffsHubSavedCommentEntry): void;
  onSelectItem(itemId: string): void;
  scrollRef: RefObject<HTMLDivElement | null>;
  source: DiffsHubFileTreeSource;
  streaming: boolean;
  themeCycle: ThemeCycleControls;
}

export const DiffsHubSidebar = memo(function DiffsHubSidebar({
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
}: DiffsHubSidebarProps) {
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
  // Portaled dropdowns (the Git-status filter) render outside the sidebar
  // wrapper, so the chrome variables set on it don't cascade. Re-apply the
  // resolved chrome on the menu surface itself, mirroring the header dropdowns.
  const dropdownThemeStyle = useMemo(
    () => getDropdownThemeStyle(sidebarStyle),
    [sidebarStyle]
  );
  const [activeStatusPanel, setActiveStatusPanel] =
    useState<SidebarStatusPanel | null>('diffStats');
  const [fileTreeModel, setFileTreeModel] = useState<FileTree | null>(null);
  // Inclusion filter: the statuses the tree should show. Empty means "no
  // filter" — every file is shown — so the menu opens with nothing checked and
  // checking statuses narrows the tree to just those.
  const [selectedStatuses, setSelectedStatuses] = useState<
    ReadonlySet<GitStatus>
  >(() => new Set());
  const availableStatuses = useMemo(
    () => getDiffsHubFileTreeAvailableStatuses(source),
    [source]
  );
  const filteredSource = useMemo(
    () => filterDiffsHubFileTreeSource(source, selectedStatuses),
    [source, selectedStatuses]
  );
  const handleModelReady = useCallback((model: FileTree | null) => {
    setFileTreeModel(model);
  }, []);
  const toggleStatusPanel = useCallback((panel: SidebarStatusPanel) => {
    setActiveStatusPanel((current) => (current === panel ? null : panel));
  }, []);

  const clearStatusFilter = useCallback(() => {
    setSelectedStatuses(new Set());
  }, []);

  const toggleSelectedStatus = useCallback((status: GitStatus) => {
    setSelectedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  // Alt+click "isolate": narrow the filter to only the clicked status. If it's
  // already the sole selection, clear the filter instead so the tree returns to
  // showing everything.
  const isolateStatus = useCallback((status: GitStatus) => {
    setSelectedStatuses((prev) => {
      if (prev.size === 1 && prev.has(status)) {
        return new Set();
      }
      return new Set([status]);
    });
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
          {activeTab === 'files' && availableStatuses.size > 1 && (
            <FileTreeFilterButton
              availableStatuses={availableStatuses}
              selectedStatuses={selectedStatuses}
              onClear={clearStatusFilter}
              onToggle={toggleSelectedStatus}
              onIsolate={isolateStatus}
              dropdownThemeStyle={dropdownThemeStyle}
            />
          )}
          {onMobileClose != null && (
            <Button
              variant="ghost"
              size="icon-only"
              className={cn(CHROME_ICON_BUTTON_CLASS, 'md:hidden')}
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
            <DiffsHubFileTree
              source={filteredSource}
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
            <DiffsHubCommentsList
              commentSections={commentSections}
              onSelectComment={onSelectComment}
              onSelectItem={onSelectItem}
            />
          </div>
        </div>
        <DiffsHubDiffStats
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

// Statuses that can appear in a diff, in the order they should appear in the
// filter dropdown. Colors mirror the exact light-dark() values from the tree's
// style.css so the badges match what the tree rows show.
const DIFF_STATUS_ITEMS: {
  status: GitStatus;
  label: string;
  short: string;
  color: string;
}[] = [
  {
    status: 'added',
    label: 'Added',
    short: 'A',
    color: 'light-dark(#16a994, #00cab1)',
  },
  {
    status: 'modified',
    label: 'Modified',
    short: 'M',
    color: 'light-dark(#1ca1c7, #08c0ef)',
  },
  {
    status: 'renamed',
    label: 'Renamed',
    short: 'R',
    color: 'light-dark(#d5a910, #ffd452)',
  },
  {
    status: 'deleted',
    label: 'Deleted',
    short: 'D',
    color: 'light-dark(#ff2e3f, #ff6762)',
  },
];

interface FileTreeFilterButtonProps {
  availableStatuses: ReadonlySet<GitStatus>;
  dropdownThemeStyle?: CSSProperties;
  onClear(): void;
  onIsolate(status: GitStatus): void;
  onToggle(status: GitStatus): void;
  selectedStatuses: ReadonlySet<GitStatus>;
}

function FileTreeFilterButton({
  availableStatuses,
  dropdownThemeStyle,
  onClear,
  onIsolate,
  onToggle,
  selectedStatuses,
}: FileTreeFilterButtonProps) {
  const isFiltered = selectedStatuses.size > 0;
  const visibleItems = DIFF_STATUS_ITEMS.filter(({ status }) =>
    availableStatuses.has(status)
  );
  const [isMac] = useState(
    () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)
  );
  // Track whether Alt was held on the most recent pointer-down so the
  // onCheckedChange handler (which receives no event) can branch on it.
  const altKeyRef = useRef(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-only"
          aria-label="Filter by Git status"
          aria-pressed={isFiltered}
          className={cn(CHROME_ICON_BUTTON_CLASS, 'relative')}
        >
          <IconFilter className="size-4 md:size-3" />
          {isFiltered && (
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-[1px] border-[var(--diffshub-sidebar-bg)] bg-blue-500 dark:bg-blue-400" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="p-2"
        style={dropdownThemeStyle}
      >
        <DropdownMenuLabel className="flex flex-col px-2 font-normal">
          Filter by Git status
          <small className="text-muted-foreground text-xs">
            {isMac ? 'Option' : 'Alt'}-click to show only one status
          </small>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-2" />
        {visibleItems.map(({ status, label, short, color }) => (
          <DropdownMenuCheckboxItem
            key={status}
            checked={selectedStatuses.has(status)}
            indicatorSide="right"
            onPointerDown={(e) => {
              altKeyRef.current = e.altKey;
            }}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => {
              if (altKeyRef.current) {
                onIsolate(status);
              } else {
                onToggle(status);
              }
            }}
            className={
              isFiltered && !selectedStatuses.has(status)
                ? 'text-muted-foreground'
                : ''
            }
          >
            <span
              className="mr-2 w-4 shrink-0 rounded-sm text-center font-mono text-xs font-semibold"
              style={{
                color,
                backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
              }}
            >
              {short}
            </span>
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator className="mx-2" />
        <DropdownMenuItem
          className="px-2"
          disabled={!isFiltered}
          onSelect={onClear}
        >
          <IconXSquircle className="mr-2 opacity-50" />
          Clear filter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
      className={CHROME_ICON_BUTTON_CLASS}
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
