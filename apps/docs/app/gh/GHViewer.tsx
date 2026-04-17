'use client';

import { type CodeViewerItem } from '@pierre/diffs';
import { useRef, useState } from 'react';

import { CodeViewerFileTree } from './CodeViewerFileTree';
import { CodeViewerHeader } from './CodeViewerHeader';
import { CodeViewerWrapper } from './CodeViewerWrapper';
import type { CommentMetadata } from './types';
import { WorkerPoolStatus } from './WorkerPoolStatus';

export function GHViewer() {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  const [key, setKey] = useState(0);
  const [items, setItems] = useState<CodeViewerItem<CommentMetadata>[]>([]);
  const [overflow, setOverflow] = useState<'wrap' | 'scroll'>('scroll');
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] [grid-template-areas:'header_header''tree_viewer']">
      <CodeViewerHeader
        className="[grid-area:header]"
        diffStyle={diffStyle}
        overflow={overflow}
        setItems={setItems}
        setOverflow={setOverflow}
        setDiffStyle={setDiffStyle}
        setKey={setKey}
      />
      <CodeViewerFileTree className="[grid-area:tree]" />
      <CodeViewerWrapper
        className="[grid-area:viewer]"
        key={key}
        diffStyle={diffStyle}
        overflow={overflow}
        scrollRef={scrollRef}
        items={items}
        setItems={setItems}
      />
      <WorkerPoolStatus scrollRef={scrollRef} />
    </div>
  );
}
