import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const CODE_VIEW_ITEM_TYPE_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_items.ts',
    contents: `type CodeViewFileItem<T = undefined> = {
  type: 'file';
  id: string;
  file: FileContents;
  annotations?: LineAnnotation<T>[];
  collapsed?: boolean;
  // Enables per-item edit mode when CodeView has a createEditor factory.
  edit?: boolean;
  // Any time a value changes on an item, you must increment the version. This
  // is an intentional escape hatch to avoid potentially expensive deep object
  // equality checks
  version?: number;
};

type CodeViewDiffItem<T = undefined> = {
  type: 'diff';
  id: string;
  fileDiff: FileDiffMetadata;
  annotations?: DiffLineAnnotation<T>[];
  collapsed?: boolean;
  // Enables per-item edit mode when CodeView has a createEditor factory.
  edit?: boolean;
  // Any time a value changes on an item, you must increment the version. This
  // is an intentional escape hatch to avoid potentially expensive deep object
  // equality checks
  version?: number;
};

type CodeViewItem<T = undefined> = CodeViewFileItem<T> | CodeViewDiffItem<T>;`,
  },
  options,
};

export const CODE_VIEW_LAYOUT_OPTIONS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_layout.ts',
    contents: `options: {
  layout: {
    // Controls how much spacing before files/diffs
    paddingTop: 16,
    // Controls how much spacing after files/diffs
    paddingBottom: 16,
    // Controls how much spacing between files/diffs
    gap: 12,
  }
}`,
  },
  options,
};

export const CODE_VIEW_ITEM_METRICS_OPTIONS_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'code_view_item_metrics.ts',
      contents: `const options: CodeViewOptions = {
  // As a general rule if you are using any \`unsafeCSS\` or custom line-height,
  // you should test with \`__devOnlyValidateItemHeights\` enabled to ensure
  // that estimations are working correctly. Otherwise CodeView's layout and
  // scrolling can become inaccurate. Don't leave this property on because it
  // incurs a significant performance penalty. With this property enabled, open
  // the console and scroll around your CodeView. If you don't see any console 
  // errors you should be good.
  __devOnlyValidateItemHeights: true,

  // Use \`itemMetrics\` to correct any issues identified by
  // \`__devOnlyValidateItemHeights\`. If you are only using default settings then
  // you shouldn't need to use \`itemMetrics\` at all. All fields are optional.
  itemMetrics: {
    // This should match your defined line-height for code. No need to define if
    // you're using the default line-height.
    lineHeight: number | undefined;

    // If you've customized the header for files or diffs via unsafeCSS in a way
    // that changes how tall they are, you'll need to set that new height here.
    diffHeaderHeight: number | undefined;

    // -------------------

    // Advanced Measurement Values - you probably should NEVER set these next
    // values unless you absolutely know what you're doing and fully understand the
    // different rendering scenarios for files and diffs

    // If you've customized hunk separators at all with unsafeCSS that changes
    // their height, you need to define that new height here.  If you've just set
    // a different type, their sizes will be handled automatically for you
    hunkSeparatorHeight: number | undefined;

    // Vertical spacing used around hunks, also gets used in calculations for
    // padding if paddingTop/Bottom are not defined. The rules for this are
    // dependent on the type of hunk separators that are used. Normally you should
    // never need to edit this unless applying custom CSS to hunk separators that
    // changes the spacing around them.  DO NOT EDIT THIS UNLESS you fully
    // understand how the CSS and HTML work.
    spacing: number | undefined;

    // Top padding applied after the file header, or before content when
    // the header is disabled.  This should match the effects of your unsafeCSS, it
    // does not actually change paddingTop.  Like the spacing prop, this is for
    // advanced use cases that fully understand how the HTML and CSS work.
    paddingTop: number | undefined;

    // Bottom padding applied after the file content and only if there is
    // code to render.  This should match the effects of your unsafeCSS, it does not
    // actually change paddingBottom.  Like the spacing prop, this is for advanced
    // use cases that fully understand how the HTML and CSS work.
    paddingBottom: number | undefined;
  }
}`,
    },
    options,
  };

export const CODE_VIEW_SCROLL_TARGETS_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_scroll_targets.ts',
    contents: `// Scroll directly to a file or diff
viewer.scrollTo({ type: 'item', id: 'diff:src/app.ts', align: 'start' });

// Scroll directly to a line in a file or diff
viewer.scrollTo({
  type: 'line',
  id: 'diff:src/app.ts',
  lineNumber: 42,
  side: 'additions',
  align: 'center',
  behavior: 'smooth-auto',
});

// Scroll directly to a range of lines in a file or diff
viewer.scrollTo({
  type: 'range',
  id: 'diff:src/app.ts',
  range: { start: 42, end: 48 },
  align: 'center',
  behavior: 'smooth-auto',
});

// Scroll directly to a pixel position in the CodeView scroll container. Generally
// you want to avoid this for scrolling to a file or line because, due to layout
// estimation: the target's actual position may change after it's rendered. It can
// still be useful for scrolling to the top.
viewer.scrollTo({ type: 'position', position: 0 });`,
  },
  options,
};

export const CODE_VIEW_REACT_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_react.tsx',
    contents: `import {
  parseDiffFromFile,
  type CodeViewItem,
  type CodeViewLineSelection,
} from '@pierre/diffs';
import { CodeView, type CodeViewHandle } from '@pierre/diffs/react';
import { useMemo, useRef, useState } from 'react';

const oldAppFile = {
  name: 'src/app.ts',
  contents: \`export function greet() {\n  return "hello";\n}\`,
};

const newAppFile = {
  name: 'src/app.ts',
  contents:
    \`export function greet(name: string) {\n  return "hello " + name;\n}\`,
};

const readmeFile = {
  name: 'README.md',
  contents: \`# Docs\n\nThis file is rendered inline with the diff list.\`,
};

const changelogFile = {
  name: 'CHANGELOG.md',
  contents: \`# Changelog\n\n- Added personalized greetings.\`,
};

export function ReviewSurface() {
  const viewerRef = useRef<CodeViewHandle | null>(null);
  const [selectedLines, setSelectedLines] =
    useState<CodeViewLineSelection | null>(null);

  const initialItems = useMemo<CodeViewItem[]>(
    () => [
      {
        id: 'diff:src/app.ts',
        type: 'diff',
        fileDiff: parseDiffFromFile(oldAppFile, newAppFile),
        annotations: [{ side: 'additions', lineNumber: 2 }],
      },
      {
        id: 'file:README.md',
        type: 'file',
        file: readmeFile,
      },
    ],
    []
  );

  return (
    <>
      <button
        type="button"
        onClick={() =>
          viewerRef.current?.scrollTo({
            type: 'line',
            id: 'diff:src/app.ts',
            lineNumber: 2,
            side: 'additions',
            behavior: 'smooth-auto',
          })
        }
      >
        Jump to change
      </button>

      <button
        type="button"
        onClick={() => {
          const viewer = viewerRef.current;
          const item = viewer?.getItem('diff:src/app.ts');
          if (item?.type !== 'diff') {
            return;
          }

          viewer.updateItem({
            ...item,
            version: item.version != null ? item.version + 1 : 1,
            collapsed: !item.collapsed,
          });
        }}
      >
        Toggle app diff
      </button>

      <button
        type="button"
        onClick={() => {
          const viewer = viewerRef.current;
          if (viewer?.getItem('file:CHANGELOG.md') != null) {
            return;
          }

          viewer?.addItems([
            {
              id: 'file:CHANGELOG.md',
              type: 'file',
              file: changelogFile,
            },
          ]);
        }}
      >
        Append changelog
      </button>

      <CodeView
        ref={viewerRef}
        initialItems={initialItems}
        style={{ height: 600, overflow: 'auto' }}
        options={{
          theme: { dark: 'pierre-dark', light: 'pierre-light' },
          stickyHeaders: true,
          enableLineSelection: true,
          enableGutterUtility: true,
          layout: { paddingTop: 16, paddingBottom: 16, gap: 12 },
        }}
        selectedLines={selectedLines}
        onSelectedLinesChange={setSelectedLines}
        renderHeaderPrefix={(item) => (
          <span>{item.type === 'diff' ? 'Diff' : 'File'}</span>
        )}
        renderHeaderMetadata={(item) =>
          item.type === 'diff' ? <span>{item.fileDiff.type}</span> : <span>file</span>
        }
        renderAnnotation={(annotation, item) => (
          <div>
            Note for {item.id} on line {annotation.lineNumber}
          </div>
        )}
      />
    </>
  );
}`,
  },
  options,
};

export const CODE_VIEW_VANILLA_EXAMPLE: PreloadFileOptions<undefined> = {
  file: {
    name: 'code_view_vanilla.ts',
    contents: `import {
  CodeView,
  parseDiffFromFile,
  type CodeViewItem,
} from '@pierre/diffs';

const root = document.getElementById('review-root');
if (root == null) {
  throw new Error('Expected #review-root to exist');
}

root.style.height = '600px';
root.style.overflow = 'auto';

const viewer = new CodeView({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  stickyHeaders: true,
  enableLineSelection: true,
  enableGutterUtility: true,
  layout: { paddingTop: 16, paddingBottom: 16, gap: 12 },
  onSelectedLinesChange(selection) {
    console.log('selected lines', selection);
  },
  renderHeaderPrefix(_headerData, context) {
    const span = document.createElement('span');
    span.textContent = context.item.type === 'diff' ? 'Diff' : 'File';
    return span;
  },
  renderHeaderMetadata(_headerData, context) {
    return context.item.type === 'diff' ? context.item.fileDiff.type : 'file';
  },
  renderGutterUtility(getHoveredLine, context) {
    const hoveredLine = getHoveredLine();
    if (hoveredLine == null || context.item.type !== 'diff') {
      return undefined;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Comment on line ' + hoveredLine.lineNumber;
    return button;
  },
});

viewer.setup(root);

const items: CodeViewItem[] = [
  {
    id: 'diff:src/app.ts',
    type: 'diff',
    fileDiff: parseDiffFromFile(
      {
        name: 'src/app.ts',
        contents: 'export function greet() {\\n  return "hello";\\n}',
      },
      {
        name: 'src/app.ts',
        contents:
          'export function greet(name: string) {\\n  return "hello " + name;\\n}',
      }
    ),
    annotations: [{ side: 'additions', lineNumber: 2 }],
  },
  {
    id: 'file:README.md',
    type: 'file',
    file: {
      name: 'README.md',
      contents: '# Docs\\n\\nThis file is rendered inline with the diff list.',
    },
  },
];

viewer.setItems(items);

viewer.scrollTo({
  type: 'line',
  id: 'diff:src/app.ts',
  lineNumber: 2,
  side: 'additions',
  behavior: 'smooth-auto',
});

const appItem = viewer.getItem('diff:src/app.ts');
if (appItem?.type === 'diff') {
  viewer.updateItem({
    ...appItem,
    version: 2,
    annotations: [{ side: 'additions', lineNumber: 2 }],
  });
}

viewer.addItems([
  {
    id: 'file:CHANGELOG.md',
    type: 'file',
    file: {
      name: 'CHANGELOG.md',
      contents: '# Changelog\\n\\n- Added personalized greetings.',
    },
  },
]);

window.addEventListener('beforeunload', () => {
  viewer.cleanUp();
});`,
  },
  options,
};

export const CODE_VIEW_HEADER_FOOTER_REACT_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'code_view_header_footer.tsx',
      contents: `import { parseDiffFromFile, type CodeViewItem } from '@pierre/diffs';
import { CodeView } from '@pierre/diffs/react';
import { useCallback, useMemo, useState } from 'react';

const oldAppFile = {
  name: 'src/app.ts',
  contents: \`export function greet() {\n  return "hello";\n}\`,
};

const newAppFile = {
  name: 'src/app.ts',
  contents:
    \`export function greet(name: string) {\n  return "hello " + name;\n}\`,
};

export function ReviewSurface() {
  const [approved, setApproved] = useState(false);

  const items = useMemo<CodeViewItem[]>(
    () => [
      {
        id: 'diff:src/app.ts',
        type: 'diff',
        fileDiff: parseDiffFromFile(oldAppFile, newAppFile),
      },
    ],
    []
  );

  // Rendered before the first item and portaled into a host element the
  // viewer manages inside the scroll container. Not virtualized: always in
  // the DOM. Memoize render callbacks so the viewer doesn't re-render the
  // header on every parent render. (don't trust react compiler).
  const renderHeader = useCallback(() => {
    return (
      <section className="pr-summary">
        <h2>Add personalized greetings</h2>
        <p>Threads a name through greet() so callers control the message.</p>
        <span>1 file changed</span>
      </section>
    );
  }, []);

  // Rendered after the last item. Plain state-driven JSX: when it re-renders
  // at a different height, the viewer re-measures automatically. List the
  // state the callback reads in the deps so updates flow through. (don't trust
  // react compiler).
  const renderFooter = useCallback(() => {
    return (
      <div className="review-actions">
        <span>{approved ? 'Approved' : 'Reviewed 1 of 1 files'}</span>
        <button type="button" onClick={() => setApproved(true)}>
          Approve changes
        </button>
      </div>
    );
  }, [approved]);

  return (
    <CodeView
      items={items}
      style={{ height: 600, overflow: 'auto' }}
      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        stickyHeaders: true,
        layout: { paddingTop: 16, paddingBottom: 16, gap: 12 },
      }}
      renderCodeViewHeader={renderHeader}
      renderCodeViewFooter={renderFooter}
    />
  );
}`,
    },
    options,
  };

export const CODE_VIEW_HEADER_FOOTER_VANILLA_EXAMPLE: PreloadFileOptions<undefined> =
  {
    file: {
      name: 'code_view_header_footer.ts',
      contents: `import { CodeView, parseDiffFromFile } from '@pierre/diffs';

const root = document.getElementById('review-root');
if (root == null) {
  throw new Error('Expected #review-root to exist');
}

root.style.height = '600px';
root.style.overflow = 'auto';

// Create the header element once, outside the callback. To update it later,
// mutate it in place: the viewer observes the host and re-measures height
// changes automatically.
const summaryCard = document.createElement('section');
summaryCard.className = 'pr-summary';
const summaryTitle = document.createElement('h2');
summaryTitle.textContent = 'Add personalized greetings';
const summaryBody = document.createElement('p');
summaryBody.textContent =
  'Threads a name through greet() so callers control the message.';
summaryCard.append(summaryTitle, summaryBody);

const approveBar = document.createElement('div');
approveBar.className = 'review-actions';
const approveButton = document.createElement('button');
approveButton.type = 'button';
approveButton.textContent = 'Approve changes';
approveButton.addEventListener('click', () => {
  // Mutating the existing element is the whole update model; no re-render
  // call is needed, and the new height is measured automatically.
  approveBar.textContent = 'Approved';
});
approveBar.append('Reviewed 1 of 1 files — ', approveButton);

const viewer = new CodeView({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  stickyHeaders: true,
  layout: { paddingTop: 16, paddingBottom: 16, gap: 12 },
  // Return the same element across calls. Returning undefined instead would
  // empty the host; removing the callback removes the host entirely.
  renderCodeViewHeader() {
    return summaryCard;
  },
  renderCodeViewFooter() {
    return approveBar;
  },
});

viewer.setup(root);

viewer.setItems([
  {
    id: 'diff:src/app.ts',
    type: 'diff',
    fileDiff: parseDiffFromFile(
      {
        name: 'src/app.ts',
        contents: 'export function greet() {\\n  return "hello";\\n}',
      },
      {
        name: 'src/app.ts',
        contents:
          'export function greet(name: string) {\\n  return "hello " + name;\\n}',
      }
    ),
  },
]);

window.addEventListener('beforeunload', () => {
  viewer.cleanUp();
});`,
    },
    options,
  };
