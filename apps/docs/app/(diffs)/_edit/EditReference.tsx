import type { ReactNode } from 'react';

import { FeatureHeader } from '@/components/FeatureHeader';

interface ReferenceItem {
  term: ReactNode;
  description: ReactNode;
}

interface ReferenceGroup {
  label: string;
  items: ReferenceItem[];
}

// The demos above each focus on one headline feature. This list rounds out the
// page with the behaviors edit mode gives you for free—most never get their own
// demo. Each group renders as one column of the grid below.
const CAPABILITY_GROUPS: ReferenceGroup[] = [
  {
    label: 'Editing',
    items: [
      {
        term: 'Files & diffs',
        description: (
          <>
            Edit a <code>File</code>, <code>FileDiff</code>, or{' '}
            <code>MultiFileDiff</code>; the new-file side of a diff re-tokenizes
            as you type.
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
          'Indent or outdent whole selections, with tabs vs. spaces detected from the file.',
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
            Edit huge files with <code>VirtualizedFile</code> /{' '}
            <code>VirtualizedFileDiff</code>; off-screen lines render on demand.
          </>
        ),
      },
      {
        term: 'Theme-aware',
        description:
          'Edited lines re-highlight against the active light or dark theme automatically.',
      },
      {
        term: 'Background tokenizing',
        description:
          'Re-highlighting is deferred during scroll and edit bursts to stay smooth.',
      },
    ],
  },
  {
    label: 'Integration & delivery',
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
        title="Everything else, at a glance"
        description={
          <>
            The demos above cover the headline features. Here's the rest of what
            edit mode gives you for free.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
        {CAPABILITY_GROUPS.map((group) => (
          <div key={group.label}>
            <h3 className="text-muted-foreground text-md mb-4 border-b pb-3 font-light">
              {group.label}
            </h3>
            <dl className="space-y-4">
              {group.items.map((item, index) => (
                <div key={index}>
                  <dt className="text-sm font-medium [&_code]:text-[0.8125rem]">
                    {item.term}
                  </dt>
                  <dd className="text-muted-foreground mt-0.5 text-sm">
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
