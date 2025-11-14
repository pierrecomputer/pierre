# Migration Guide: git-diff-view → precision-diffs

A focused guide for migrating from [`git-diff-view`](https://github.com/MrWangJustToDo/git-diff-view) to `@pierre/precision-diffs`.

## Installation

```bash
# Remove old package
bun remove @git-diff-view/react

# Install precision-diffs
bun add @pierre/precision-diffs
```

## Core Differences

| git-diff-view               | precision-diffs                                              |
| --------------------------- | ------------------------------------------------------------ |
| Single `DiffView` component | Separate `MultiFileDiff`, `PatchDiff`, `FileDiff` components |
| Props-based configuration   | Options object + separate props                              |
| Manual theme initialization | Automatic theme handling                                     |
| CSS imports required        | Shadow DOM with built-in styles                              |
| Widget/Extend line system   | Annotation system with slots                                 |

## Basic Migration

### Before: git-diff-view

```tsx
import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';

<DiffView
  data={{
    oldFile: { fileName: 'file.ts', content: oldContent },
    newFile: { fileName: 'file.ts', content: newContent },
    hunks: [],
  }}
  diffViewMode={DiffModeEnum.Split}
  diffViewWrap={false}
  diffViewTheme="dark"
  diffViewHighlight={true}
  diffViewFontSize={14}
/>;
```

### After: precision-diffs

```tsx
import { MultiFileDiff } from '@pierre/precision-diffs/react';

<MultiFileDiff
  oldFile={{ name: 'file.ts', contents: oldContent }}
  newFile={{ name: 'file.ts', contents: newContent }}
  options={{
    diffStyle: 'split',
    overflow: 'scroll',
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'system',
  }}
/>;
```

## Prop Mapping

### Display Options

| git-diff-view                         | precision-diffs                       |
| ------------------------------------- | ------------------------------------- |
| `diffViewMode={DiffModeEnum.Split}`   | `options={{ diffStyle: 'split' }}`    |
| `diffViewMode={DiffModeEnum.Unified}` | `options={{ diffStyle: 'unified' }}`  |
| `diffViewWrap={true}`                 | `options={{ overflow: 'wrap' }}`      |
| `diffViewWrap={false}`                | `options={{ overflow: 'scroll' }}`    |
| `diffViewTheme="dark"`                | `options={{ theme: 'pierre-dark' }}`  |
| `diffViewTheme="light"`               | `options={{ theme: 'pierre-light' }}` |
| `diffViewHighlight={false}`           | Not available (always highlighted)    |
| `diffViewFontSize={14}`               | Use CSS variables (see below)         |

### Data Input

**git-diff-view: Object-based**

```tsx
data={{
  oldFile: { fileName: "foo.ts", content: "..." },
  newFile: { fileName: "foo.ts", content: "..." },
  hunks: []
}}
```

**precision-diffs: Separate props**

```tsx
oldFile={{ name: "foo.ts", contents: "..." }}
newFile={{ name: "foo.ts", contents: "..." }}
```

## Using Patch Strings

### Before: git-diff-view with hunks

```tsx
<DiffView
  data={{
    hunks: [
      'diff --git a/foo.ts b/foo.ts',
      '--- a/foo.ts',
      '+++ b/foo.ts',
      '@@ -1,3 +1,3 @@',
      '-old line',
      '+new line',
    ],
  }}
/>
```

### After: precision-diffs with PatchDiff

```tsx
import { PatchDiff } from '@pierre/precision-diffs/react';

<PatchDiff
  patch={`diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,3 @@
-old line
+new line`}
  options={{ diffStyle: 'split' }}
/>;
```

## Widgets → Annotations

The widget system in git-diff-view maps to the annotation system in precision-diffs.

### Before: git-diff-view widgets

```tsx
<DiffView
  data={data}
  diffViewAddWidget={true}
  onAddWidgetClick={({ side, lineNumber }) => {
    // Handle widget add
  }}
  renderWidgetLine={({ onClose, side, lineNumber }) => (
    <CommentBox onClose={onClose} />
  )}
/>
```

### After: precision-diffs annotations

```tsx
import {
  type DiffLineAnnotation,
  MultiFileDiff,
} from '@pierre/precision-diffs/react';

interface CommentMetadata {
  commentId: string;
}

const annotations: DiffLineAnnotation<CommentMetadata>[] = [
  {
    side: 'additions', // or 'deletions'
    lineNumber: 5,
    metadata: { commentId: '123' },
  },
];

<MultiFileDiff
  oldFile={oldFile}
  newFile={newFile}
  lineAnnotations={annotations}
  renderLineAnnotation={(annotation) => (
    <CommentBox commentId={annotation.metadata.commentId} />
  )}
/>;
```

## Extend Lines → Annotations

Extended data lines use the same annotation system.

### Before: git-diff-view extend lines

```tsx
<DiffView
  data={data}
  extendData={{
    oldFile: { 10: { data: 'custom data' } },
    newFile: { 20: { data: 'custom data' } },
  }}
  renderExtendLine={({ data }) => <CustomLine data={data} />}
/>
```

### After: precision-diffs

```tsx
const annotations: DiffLineAnnotation<CustomData>[] = [
  {
    side: 'deletions',
    lineNumber: 10,
    metadata: { data: 'custom data' },
  },
  {
    side: 'additions',
    lineNumber: 20,
    metadata: { data: 'custom data' },
  },
];

<MultiFileDiff
  oldFile={oldFile}
  newFile={newFile}
  lineAnnotations={annotations}
  renderLineAnnotation={(annotation) => (
    <CustomLine data={annotation.metadata.data} />
  )}
/>;
```

## Line Selection

### Before: git-diff-view

git-diff-view doesn't have built-in line selection.

### After: precision-diffs

```tsx
<MultiFileDiff
  oldFile={oldFile}
  newFile={newFile}
  selectedLines={{
    start: 5,
    end: 10,
    side: 'additions',
  }}
  options={{
    enableLineSelection: true,
    onLineSelectionEnd: (range) => {
      console.log('Selected lines:', range);
    },
  }}
/>
```

## Advanced Options

### git-diff-view DiffFile API

```tsx
import { DiffFile, generateDiffFile } from '@git-diff-view/file';

const file = generateDiffFile(
  oldFileName,
  oldContent,
  newFileName,
  newContent,
  oldLang,
  newLang
);
file.initTheme('dark');
file.init();
file.buildSplitDiffLines();

<DiffView diffFile={file} />;
```

### precision-diffs Vanilla API

```tsx
import { FileDiff } from '@pierre/precision-diffs';

const instance = new FileDiff({
  theme: 'pierre-dark',
  diffStyle: 'split',
});

await instance.render({
  oldFile: { name: oldFileName, contents: oldContent },
  newFile: { name: newFileName, contents: newContent },
  containerWrapper: document.getElementById('diff-container'),
});
```

## Styling

### git-diff-view: External CSS

```tsx
import '@git-diff-view/react/styles/diff-view.css';

// Custom overrides via className
```

### precision-diffs: CSS Variables

No imports needed (Shadow DOM), but you can customize via CSS variables:

```css
pierre-file-diff {
  --pjs-font-size: 14px;
  --pjs-font-family: 'Monaco', monospace;
  --pjs-line-height: 1.5;
}
```

## Hunk Separators

### git-diff-view

Limited customization of collapsed regions.

### precision-diffs

```tsx
<MultiFileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{
    // 'line-info': Clickable bars showing line count
    // 'metadata': Patch-style "@@ -60,6 +60,22 @@"
    // 'simple': Subtle separator bar
    hunkSeparators: 'line-info',

    // Control collapsed region expansion
    expandUnchanged: false,
    expansionLineCount: 100,
  }}
/>
```

## Diff Indicators

### precision-diffs adds granular control

```tsx
<MultiFileDiff
  oldFile={oldFile}
  newFile={newFile}
  options={{
    // 'bars': Colored bars on left edge (default)
    // 'classic': Shows +/- characters
    // 'none': No indicators
    diffIndicators: 'bars',

    // Inline word-level highlighting
    lineDiffType: 'word-alt', // 'none' | 'char' | 'word' | 'word-alt'

    // Background colors on changed lines
    disableBackground: false,
  }}
/>
```

## SSR Support

Both libraries support SSR, but with different approaches.

### git-diff-view SSR

Requires manual setup and hydration.

### precision-diffs SSR

```tsx
import { preloadSSR } from '@pierre/precision-diffs/ssr';

// Server-side
const { html, styles } = await preloadSSR({
  file: { name: 'file.ts', contents: '...' },
  options: { theme: 'pierre-dark' },
});

// Automatic hydration on client
```

## Migration Checklist

- [ ] Update package imports
- [ ] Remove CSS imports (Shadow DOM handles styles)
- [ ] Convert `DiffView` to `MultiFileDiff` or `PatchDiff`
- [ ] Rename `data` prop to `oldFile`/`newFile` or `patch`
- [ ] Move view options into `options` object
- [ ] Update `diffViewMode` to `diffStyle`
- [ ] Update `diffViewWrap` to `overflow`
- [ ] Update `diffViewTheme` to `theme`
- [ ] Convert widgets to annotations
- [ ] Convert extend lines to annotations
- [ ] Update event handlers (if using line selection)
- [ ] Test theme switching behavior
- [ ] Remove custom CSS overrides (use CSS variables instead)

## Key Benefits After Migration

✅ **Shadow DOM**: No CSS conflicts
✅ **Better TypeScript**: Full type safety for annotations
✅ **Line Selection**: Built-in interactive selection
✅ **Stable API**: Separate components for different use cases
✅ **Performance**: Optimized rendering with Web Components
✅ **Flexibility**: More granular control over diff display
