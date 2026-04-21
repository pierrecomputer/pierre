'use client';

import { memo, useId, useState } from 'react';

import { CodeViewerCommentsList } from './CodeViewerCommentsList';
import { CodeViewerFileTree } from './CodeViewerFileTree';
import type {
  CodeViewerFileTreeSource,
  CodeViewerSavedCommentEntry,
  CodeViewerSavedCommentItem,
} from './types';
import { cn } from '@/lib/utils';

type SidebarTab = 'files' | 'comments';

interface CodeViewerSidebarProps {
  className?: string;
  commentSections: readonly CodeViewerSavedCommentItem[];
  onSelectComment?(comment: CodeViewerSavedCommentEntry): void;
  onSelectItem?(itemId: string): void;
  source: CodeViewerFileTreeSource | null;
}

function getTabClassName(active: boolean): string {
  return cn(
    'inline-flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none',
    active
      ? 'bg-background text-foreground shadow-xs'
      : 'text-muted-foreground hover:text-foreground cursor-pointer'
  );
}

export const CodeViewerSidebar = memo(function CodeViewerSidebar({
  className,
  commentSections,
  onSelectComment,
  onSelectItem,
  source,
}: CodeViewerSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('files');
  const filesTabId = useId();
  const commentsTabId = useId();
  const filesPanelId = useId();
  const commentsPanelId = useId();

  return (
    <div
      className={cn('bg-background flex h-full min-h-0 flex-col', className)}
    >
      <div className="border-border border-b p-2">
        <div
          role="tablist"
          aria-label="Sidebar sections"
          className="bg-muted flex w-full rounded-lg p-1"
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
      </div>
      <div className="min-h-0 flex-1">
        <div
          id={filesPanelId}
          role="tabpanel"
          aria-labelledby={filesTabId}
          hidden={activeTab !== 'files'}
          className="h-full min-h-0"
        >
          <CodeViewerFileTree
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
          <CodeViewerCommentsList
            commentSections={commentSections}
            onSelectComment={onSelectComment}
          />
        </div>
      </div>
    </div>
  );
});
