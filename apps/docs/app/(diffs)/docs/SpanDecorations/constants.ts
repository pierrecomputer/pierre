import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const SPAN_DECORATIONS_REACT: PreloadFileOptions<undefined> = {
  file: {
    name: 'span_decorations.tsx',
    contents: `import type { DiffSpanDecoration } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';

const oldFile = {
  name: 'query.ts',
  contents: "const user = db.query('SELECT * FROM users WHERE id = ?', [id]);",
};

const newFile = {
  name: 'query.ts',
  contents: 'const user = db.query("SELECT * FROM users WHERE id = " + id);',
};

// Decorations address character ranges on rendered lines:
// 1-based lineNumber, 0-based spanStart, end-exclusive length.
// Diff decorations also take a side, like DiffLineAnnotation.
// Keep decoration arrays stable (useState/useMemo) to avoid re-highlights.
const spanDecorations: DiffSpanDecoration[] = [
  {
    side: 'additions',
    lineNumber: 1,
    spanStart: 22,
    spanLength: 39,
    className: 'hl-risk',
  },
];

export function SpanDecorationsExample() {
  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      // Decorations are render props (content-coupled, like
      // lineAnnotations), not options.
      spanDecorations={spanDecorations}
      options={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },

        // Decoration spans render inside the shadow DOM, so classes
        // are styled through unsafeCSS.
        unsafeCSS: \`
          .hl-risk {
            background: light-dark(
              rgba(220, 38, 38, 0.14),
              rgba(248, 113, 113, 0.18)
            );
            box-shadow: inset 0 -2px 0 light-dark(#dc2626, #f87171);
            border-radius: 2px;
          }
        \`,

        // Optional interaction callbacks, mirroring onToken*.
        // Props carry your original decoration object plus the
        // rendered span element to anchor popovers against.
        onDecorationClick({ decoration, decorationElement, lineNumber, side }) {
          console.log('clicked decoration', {
            className: decoration.className,
            lineNumber,
            side,
            rect: decorationElement.getBoundingClientRect(),
          });
        },
        onDecorationEnter({ decorationElement }) {
          decorationElement.style.outline = '1px solid currentColor';
        },
        onDecorationLeave({ decorationElement }) {
          decorationElement.style.outline = '';
        },
      }}
    />
  );
}`,
  },
  options,
};

export const SPAN_DECORATIONS_VANILLA: PreloadFileOptions<undefined> = {
  file: {
    name: 'span_decorations.ts',
    contents: `import {
  FileDiff,
  type DiffSpanDecoration,
} from '@pierre/diffs';

const instance = new FileDiff({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },

  // Decoration spans render inside the shadow DOM, so classes are
  // styled through unsafeCSS.
  unsafeCSS: \`
    .hl-risk {
      background: light-dark(
        rgba(220, 38, 38, 0.14),
        rgba(248, 113, 113, 0.18)
      );
      box-shadow: inset 0 -2px 0 light-dark(#dc2626, #f87171);
      border-radius: 2px;
    }
  \`,

  // Optional interaction callbacks, mirroring onToken*.
  onDecorationClick({ decoration, decorationElement, lineNumber, side }) {
    console.log('clicked decoration', {
      className: decoration.className,
      lineNumber,
      side,
      rect: decorationElement.getBoundingClientRect(),
    });
  },
  onDecorationEnter({ decorationElement }) {
    decorationElement.style.outline = '1px solid currentColor';
  },
  onDecorationLeave({ decorationElement }) {
    decorationElement.style.outline = '';
  },
});

// Decorations address character ranges on rendered lines:
// 1-based lineNumber, 0-based spanStart, end-exclusive length.
// Diff decorations also take a side, like DiffLineAnnotation.
const spanDecorations: DiffSpanDecoration[] = [
  {
    side: 'additions',
    lineNumber: 1,
    spanStart: 22,
    spanLength: 39,
    className: 'hl-risk',
  },
];

instance.render({
  oldFile: {
    name: 'query.ts',
    contents: "const user = db.query('SELECT * FROM users WHERE id = ?', [id]);",
  },
  newFile: {
    name: 'query.ts',
    contents: 'const user = db.query("SELECT * FROM users WHERE id = " + id);',
  },
  spanDecorations,
  containerWrapper: document.getElementById('diff-container'),
});

// Update decorations after the initial render
instance.render({
  spanDecorations: [
    {
      side: 'additions',
      lineNumber: 1,
      spanStart: 22,
      spanLength: 39,
      className: 'hl-risk',
    },
  ],
});`,
  },
  options,
};
