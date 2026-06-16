import {
  IconCiWarning,
  IconClockArrow,
  IconCursor,
  IconDiffUnified,
  IconFileCode,
  type IconProps,
  IconSearch,
} from '@pierre/icons';
import type { ComponentType, ReactNode } from 'react';

interface EditFeature {
  icon: ComponentType<IconProps>;
  title: string;
  description: ReactNode;
}

// The "mostly there" feature set, mirrored from the editor docs. Each card is
// intentionally terse; the functional demos below the grid show them in action.
const FEATURES: EditFeature[] = [
  {
    icon: IconFileCode,
    title: 'Edit files',
    description: (
      <>
        Make any <code>File</code> surface editable with one{' '}
        <code>contentEditable</code> prop. The renderer keeps owning syntax
        highlighting, layout, and virtualization.
      </>
    ),
  },
  {
    icon: IconDiffUnified,
    title: 'Edit diffs',
    description: (
      <>
        Edit the new-file side of a <code>FileDiff</code> in place. Additions
        re-tokenize as you type, in both unified and split styles.
      </>
    ),
  },
  {
    icon: IconCursor,
    title: 'Selection management',
    description: (
      <>
        Native selection with multiple cursors. Cmd/Ctrl-click to add a caret;
        edits apply to every non-overlapping selection at once.
      </>
    ),
  },
  {
    icon: IconClockArrow,
    title: 'History API',
    description: (
      <>
        Built-in undo and redo stack that tracks structure-aware edits like
        indent, paste, and multi-cursor changes.
      </>
    ),
  },
  {
    icon: IconSearch,
    title: 'Find & replace',
    description: (
      <>
        Find-in-file search and a built-in search panel for jumping between and
        replacing matches without leaving the surface.
      </>
    ),
  },
  {
    icon: IconCiWarning,
    title: 'Lint markers',
    description: (
      <>
        Surface diagnostics inline with severity-aware markers and hover popups,
        driven by your own linter or language tooling.
      </>
    ),
  },
];

// Static, server-rendered overview grid of the editor's shipped capabilities.
export function EditFeatures() {
  return (
    <section className="space-y-5">
      <div className="max-w-3xl">
        <h2
          id="features"
          className="scroll-mt-20 text-2xl font-medium tracking-tight"
        >
          Everything you need to edit in place
        </h2>
        <p className="text-muted-foreground text-md">
          The editor is a pluggable layer on top of the same surfaces you
          already render. Attach it when editing is needed, and lazy-load it so
          your initial bundle stays small.
        </p>
      </div>

      <div className="bg-border grid grid-cols-1 gap-px overflow-hidden rounded-xl border sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className="bg-card flex flex-col gap-2 p-5"
            >
              <Icon className="text-muted-foreground size-5" />
              <h3 className="text-base font-medium">{feature.title}</h3>
              <p className="text-muted-foreground text-sm">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
