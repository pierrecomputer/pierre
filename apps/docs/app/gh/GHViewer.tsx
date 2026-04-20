'use client';

import { type CodeViewerItem } from '@pierre/diffs';
import { type CodeViewerHandle } from '@pierre/diffs/react';
import { useCallback, useRef, useState } from 'react';

import { CodeViewerFileTree } from './CodeViewerFileTree';
import { CodeViewerHeader } from './CodeViewerHeader';
import { CodeViewerWrapper } from './CodeViewerWrapper';
import type { CodeViewerFileTreeSource, CommentMetadata } from './types';
import { WorkerPoolStatus } from './WorkerPoolStatus';

export function GHViewer() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [key, setKey] = useState(0);
  const [items, setItems] = useState<CodeViewerItem<CommentMetadata>[]>([]);
  // Tree data is intentionally stored separately from items so annotation
  // updates do not cascade into the file tree and trigger needless rebuilds.
  // It is rebuilt once per fetch inside CodeViewerHeader.
  const [treeSource, setTreeSource] = useState<CodeViewerFileTreeSource | null>(
    null
  );
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CodeViewerHandle<CommentMetadata> | null>(null);
  const handleSelectTreeItem = useCallback((itemId: string) => {
    viewerRef.current?.scrollTo({
      type: 'item',
      id: itemId,
      align: 'start',
      offset: 20,
      behavior: 'smooth',
    });
  }, []);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] contain-strict [grid-template-areas:'header_header''tree_viewer']">
      <CodeViewerHeader
        className="contain-layout contain-paint [grid-area:header]"
        diffStyle={diffStyle}
        overflow={overflow}
        setItems={setItems}
        setOverflow={setOverflow}
        setDiffStyle={setDiffStyle}
        setKey={setKey}
        setTreeSource={setTreeSource}
      />
      <CodeViewerFileTree
        className="contain-strict [grid-area:tree]"
        source={treeSource}
        onSelectItem={handleSelectTreeItem}
      />
      <CodeViewerWrapper
        className="contain-strict [grid-area:viewer]"
        key={key}
        diffStyle={diffStyle}
        overflow={overflow}
        scrollRef={scrollRef}
        viewerRef={viewerRef}
        items={items}
        setItems={setItems}
      />
      <WorkerPoolStatus scrollRef={scrollRef} />
    </div>
  );
}
