import {
  IconBoxTape,
  IconCodeBlock,
  IconDiffSplit,
  type IconProps,
} from '@pierre/icons';
import type { ComponentType, ReactNode } from 'react';

import { FeatureHeader } from '@/components/FeatureHeader';

interface ReferenceItem {
  term: ReactNode;
  description: ReactNode;
}

interface ReferenceGroup {
  label: string;
  icon: ComponentType<IconProps>;
  headingClassName: string;
  items: ReferenceItem[];
}

// The demos above each focus on one headline feature. This list rounds out the
// page with the behaviors edit mode gives you for free—most never get their own
// demo. Each group renders as one column of the grid below.
const CAPABILITY_GROUPS: ReferenceGroup[] = [
  {
    label: 'Editing',
    icon: IconCodeBlock,
    headingClassName: 'border-blue-500/30 text-blue-500',
    items: [
      {
        term: 'Files & diffs',
        description: (
          <>
            Edit a <code>File</code>, <code>FileDiff</code>,{' '}
            <code>MultiFileDiff</code>, or <code>PatchDiff</code>; the new-file
            side of a diff re-tokenizes as you type.
          </>
        ),
      },
      {
        term: 'Multiple cursors',
        description:
          'Cmd/Ctrl-click adds carets; one edit applies to every selection and overlapping ranges merge.',
      },
      {
        term: 'Smart indentation',
        description:
          "Indent or outdent whole selections, with tab vs. space inferred from each line's existing indentation.",
      },
      {
        term: 'International input',
        description:
          'Compose CJK and other scripts, dictation, and emoji through the IME.',
      },
    ],
  },
  {
    label: 'Rendering',
    icon: IconDiffSplit,
    headingClassName: 'border-purple-500/30 text-purple-500',
    items: [
      {
        term: 'Line wrapping',
        description:
          'Carets, selections, and matches render correctly across wrapped visual lines.',
      },
      {
        term: 'Virtualized files',
        description: (
          <>
            Use <code>VirtualizedFile</code> and{' '}
            <code>VirtualizedFileDiff</code> to edit massive files; off-screen
            lines render on demand.
          </>
        ),
      },
      {
        term: 'Themes & color modes',
        description:
          'Tokens and editor chrome follow the surface theme, re-tokenizing live when you switch themes or toggle light and dark.',
      },
      {
        term: 'UI adapts to container',
        description:
          'Container queries reflow find & replace panel and marker popovers at narrow widths for a smoother experience, no matter the layout.',
      },
    ],
  },
  {
    label: 'Integration & delivery',
    icon: IconBoxTape,
    headingClassName: 'border-rose-500/30 text-rose-500',
    items: [
      {
        term: 'Diff annotations',
        description:
          'Line annotations shift and survive edits and undo—the basis for agent/AUI surfaces.',
      },
      {
        term: 'SSR & hydration',
        description:
          'Hydrate from prerendered, already-highlighted HTML with no flash.',
      },
      {
        term: 'Mobile & a11y',
        description: (
          <>
            Native <code>contentEditable</code> with{' '}
            <code>role=&quot;textbox&quot;</code>; autocorrect, spellcheck, and
            capitalization off.
          </>
        ),
      },
      {
        term: 'Lazy-loadable',
        description: (
          <>
            Standalone <code>@pierre/diffs/editor</code> entry point—import it
            only when editing begins.
          </>
        ),
      },
    ],
  },
];

// Static, server-rendered reference closing out the edit page: a dense,
// columned list of the built-in behaviors the demos above don't spell out
// individually.
export function EditReference() {
  return (
    <div className="space-y-5">
      <FeatureHeader
        id="reference"
        title="And everything else you need…"
        description={
          <>
            The demos above cover the headline features. Here's the rest of what
            edit mode gives you for free.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-12 lg:grid-cols-3">
        {CAPABILITY_GROUPS.map((group) => (
          <div key={group.label}>
            <h3
              className={`text-foreground mb-5 flex flex-col gap-1.5 border-b pb-4 text-lg font-light`}
            >
              <group.icon className={`size-5 ${group.headingClassName}`} />
              {group.label}
            </h3>
            <dl className="space-y-5">
              {group.items.map((item, index) => (
                <div key={index}>
                  <dt className="text-sm font-medium [&_code]:text-[0.8125rem]">
                    {item.term}
                  </dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm text-pretty">
                    {item.description}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
