'use client';

import { IconX } from '@pierre/icons';
import { memo, type RefObject, useId, useState } from 'react';

import { CodeViewCommentsList } from './CodeViewCommentsList';
import { CodeViewFileTree } from './CodeViewFileTree';
import type {
  CodeViewFileTreeSource,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentItem,
} from './types';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { cn } from '@/lib/utils';

type SidebarTab = 'files' | 'comments';

interface CodeViewSidebarProps {
  className?: string;
  commentSections: readonly CodeViewSavedCommentItem[];
  mobileOverlayOpen?: boolean;
  onMobileClose?(): void;
  onSelectComment?(comment: CodeViewSavedCommentEntry): void;
  onSelectItem?(itemId: string): void;
  scrollRef: RefObject<HTMLDivElement | null>;
  source: CodeViewFileTreeSource | null;
}

function getTabClassName(active: boolean): string {
  return cn(
    'inline-flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none',
    active
      ? 'bg-background text-foreground shadow-xs'
      : 'text-muted-foreground hover:text-foreground cursor-pointer'
  );
}

export const CodeViewSidebar = memo(function CodeViewSidebar({
  className,
  commentSections,
  mobileOverlayOpen = false,
  onMobileClose,
  onSelectComment,
  onSelectItem,
  scrollRef,
  source,
}: CodeViewSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('files');
  const filesTabId = useId();
  const commentsTabId = useId();
  const filesPanelId = useId();
  const commentsPanelId = useId();

  return (
    <>
      <button
        type="button"
        aria-hidden={!mobileOverlayOpen}
        aria-label="Close file tree"
        tabIndex={mobileOverlayOpen ? 0 : -1}
        className={cn(
          'z-20 cursor-default bg-background/40 transition-opacity [grid-column:1/-1] [grid-row:1/-1] md:hidden',
          mobileOverlayOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
        onClick={onMobileClose}
      />
      <div
        className={cn(
          'bg-background contain-strict z-30 flex h-full min-h-0 flex-col transition-transform duration-200 ease-out will-change-transform [grid-area:viewer] motion-reduce:transition-none md:z-auto md:translate-y-0 md:will-change-auto md:[grid-area:tree]',
          mobileOverlayOpen
            ? 'border-border pointer-events-auto m-3 h-[calc(100%_-_1.5rem_-_env(safe-area-inset-bottom))] translate-y-0 overflow-hidden rounded-xl border shadow-2xl md:m-0 md:h-full md:overflow-visible md:rounded-none md:border-0 md:shadow-none'
            : 'pointer-events-none m-3 h-[calc(100%_-_1.5rem_-_env(safe-area-inset-bottom))] translate-y-[calc(100%+1.5rem)] overflow-hidden rounded-xl border border-transparent md:pointer-events-auto md:m-0 md:h-full md:overflow-visible md:rounded-none md:border-0',
          className
        )}
      >
        <div className="border-border border-b p-2">
          <div className="flex items-center gap-2">
            <div
              role="tablist"
              aria-label="Sidebar sections"
              className="bg-muted flex min-w-0 flex-1 rounded-lg p-1"
            >
              <button
                id={filesTabId}
                type="button"
                role="tab"
                aria-selected={activeTab === 'files'}
                aria-controls={filesPanelId}
                tabIndex={activeTab === 'files' ? 0 : -1}
                className={getTabClassName(activeTab === 'files')}
                onClick={() => setActiveTab('files')}
              >
                Files
              </button>
              <button
                id={commentsTabId}
                type="button"
                role="tab"
                aria-selected={activeTab === 'comments'}
                aria-controls={commentsPanelId}
                tabIndex={activeTab === 'comments' ? 0 : -1}
                className={getTabClassName(activeTab === 'comments')}
                onClick={() => setActiveTab('comments')}
              >
                Comments
              </button>
            </div>
            {onMobileClose != null && (
              <button
                type="button"
                aria-label="Close file tree"
                className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-2 md:hidden"
                onClick={onMobileClose}
              >
                <IconX className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <div
            id={filesPanelId}
            role="tabpanel"
            aria-labelledby={filesTabId}
            hidden={activeTab !== 'files'}
            className="h-full min-h-0"
          >
            {/* <style>{`@media (min-width: 768px) { #${filesPanelId.replace(/:/g, '\\:')} { --color-background: light-dark(oklch(98.5% 0 0), oklch(20.5% 0 0)) } }`}</style> */}
            <CodeViewFileTree
              className="h-full min-h-0"
              source={source}
              onSelectItem={onSelectItem}
            />
          </div>
          <div
            id={commentsPanelId}
            role="tabpanel"
            aria-labelledby={commentsTabId}
            hidden={activeTab !== 'comments'}
            className="h-full min-h-0"
          >
            <CodeViewCommentsList
              commentSections={commentSections}
              onSelectComment={onSelectComment}
            />
          </div>
        </div>
        <WorkerPoolStatus scrollRef={scrollRef} />
      </div>
    </>
  );
});
