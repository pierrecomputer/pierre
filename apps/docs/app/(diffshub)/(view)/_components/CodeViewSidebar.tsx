'use client';

import { IconComment, IconFileTree, IconSearch, IconX } from '@pierre/icons';
import { FileTree } from '@pierre/trees';
import { useFileTreeSearch } from '@pierre/trees/react';
import { memo, type RefObject, useCallback, useState } from 'react';

import { CodeViewCommentsList } from './CodeViewCommentsList';
import { CodeViewFileTree } from './CodeViewFileTree';
import type {
  CodeViewFileTreeSource,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentItem,
} from './types';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
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
  const [fileTreeModel, setFileTreeModel] = useState<FileTree | null>(null);
  const handleModelReady = useCallback((model: FileTree | null) => {
    setFileTreeModel(model);
  }, []);

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
      <div
        className={cn(
          'contain-strict z-30 flex h-full min-h-0 flex-col transition-transform duration-200 ease-out will-change-transform  motion-reduce:transition-none md:z-auto md:translate-y-0 md:will-change-auto',
          mobileOverlayOpen
            ? 'bg-neutral-50 dark:bg-neutral-900 p-3 border-border pointer-events-auto m-3 h-[calc(100%_-_1.5rem_-_env(safe-area-inset-bottom))] translate-y-0 overflow-hidden rounded-xl border shadow-2xl md:m-0 md:h-full md:overflow-visible md:rounded-none md:border-0 md:shadow-none'
            : 'pointer-events-none m-3 h-[calc(100%_-_1.5rem_-_env(safe-area-inset-bottom))] translate-y-[calc(100%+1.5rem)] overflow-hidden rounded-xl border border-transparent md:pointer-events-auto md:m-0 md:h-full md:overflow-visible md:rounded-none md:border-0 p-0 pt-4',
          className
        )}
      >
        {source != null && (
          <div className="px-2">
            <div className="flex items-center gap-1">
              <ButtonGroup
                aria-label="Sidebar sections"
                className="mr-auto flex min-w-0"
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as SidebarTab)}
              >
                <ButtonGroupItem value="files" className="size-9 p-0">
                  <IconFileTree />
                  <span className="sr-only">Files</span>
                </ButtonGroupItem>
                <ButtonGroupItem value="comments" className="size-9 p-0">
                  <IconComment />
                  <span className="sr-only">Comments</span>
                </ButtonGroupItem>
              </ButtonGroup>
              {activeTab === 'files' && fileTreeModel != null && (
                <FileTreeSearchToggle model={fileTreeModel} />
              )}
              {onMobileClose != null && (
                <Button
                  variant="muted"
                  size="icon"
                  className="md:hidden"
                  aria-label="Close file tree"
                  onClick={onMobileClose}
                >
                  <IconX className="size-4" />
                </Button>
              )}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1">
          <div
            role="region"
            aria-label="Files"
            hidden={activeTab !== 'files'}
            className="h-full min-h-0"
          >
            <CodeViewFileTree
              className="h-full min-h-0 pl-2"
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
            />
          </div>
        </div>
        {source != null && <WorkerPoolStatus scrollRef={scrollRef} />}
      </div>
    </>
  );
});

// Lives in its own component so we can call useFileTreeSearch only once we
// actually have a model; conditional hook calls aren't allowed in the parent.
function FileTreeSearchToggle({ model }: { model: FileTree }) {
  const search = useFileTreeSearch(model);
  return (
    <Button
      type="button"
      variant={search.isOpen ? 'outline' : 'muted'}
      size="icon"
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
      <IconSearch className="size-4" />
    </Button>
  );
}
