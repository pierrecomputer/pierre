'use client';

import type { CodeViewItem, CodeViewOptions } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';

interface PlaygroundCodeViewProps {
  items: CodeViewItem[];
  options: CodeViewOptions<undefined>;
}

// Renders a mix of diff and file items in a CodeView. Unlike the Virtualizer
// mode, CodeView manages its own scroll container, so we give it a fixed height
// and `overflow: auto`. Items are static (seeded via `initialItems`); live
// option changes flow through the `options` prop, which the React wrapper
// reconciles onto the underlying instance.
export function PlaygroundCodeView({
  items,
  options,
}: PlaygroundCodeViewProps) {
  return (
    <CodeView
      initialItems={items}
      className="border-border overflow-hidden rounded-lg border"
      style={{ height: '70vh', overflow: 'auto' }}
      options={options}
    />
  );
}
