import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { useState } from 'react';

const CODE = `import {
  type FileContents,
  type DiffLineAnnotation,
  FileDiff,
} from '@pierre/precision-diffs/react';

const oldFile: FileContents = {
  name: 'filename.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
  name: 'filename.ts',
  contents: 'console.warn("Uh oh")',
};

interface ThreadMetadata {
  threadId: string;
}

// Annotation metadata can be typed any way you'd like
const lineAnnotations: DiffLineAnnotation<ThreadMetadata>[] = [
  {
    side: 'additions',
    // The line number specified for an annotation is the visual line number
    // you see in the number column of a diff
    lineNumber: 16,
    metadata: { threadId: '68b329da9893e34099c7d8ad5cb9c940' },
  },
];

// Comparing two files
export function SingleDiff() {
  return (
    <FileDiff<ThreadMetadata>
      // We automatically detect the language based on filename
      // You can also provide 'lang' property in 'options' when
      // rendering FileDiff.
      oldFile={oldFile}
      newFile={newFile}
      lineAnnotations={lineAnnotations}
      renderLineAnnotation={(annotation: DiffLineAnnotation) => {
        // Despite the diff itself being rendered in the shadow dom,
        // annotations are inserted via the web components 'slots' api and you
        // can use all your normal normal css and styling for them
        return <CommentThread threadId={annotation.metadata.threadId} />;
      }}
      // Here's every property you can pass to options, with their default
      // values if not specified. However its generally a good idea to pass
      // a 'theme' or 'themes' property
      options={{
        // You can provide a 'theme' prop that maps to any
        // built in shiki theme or you can register a custom
        // theme. We also include 2 custom themes
        //
        // 'pierre-dark' and 'pierre-light
        //
        // For the rest of the  available shiki themes, check out:
        // https://shiki.style/themes
        theme: 'none',
        // Or can also provide a 'themes' prop, which allows the code to adapt
        // to your OS light or dark theme
        // themes: { dark: 'pierre-dark', light: 'pierre-light' },

        // When using the 'themes' prop, 'themeType' allows you to force 'dark'
        // or 'light' theme, or inherit from the OS ('system') theme.
        themeType: 'system',

        // Disable the line numbers for your diffs, generally not recommended
        disableLineNumbers: false,

        // Whether code should 'wrap' with long lines or 'scroll'.
        overflow: 'scroll',

        // Normally you shouldn't need this prop, but if you don't provide a
        // valid filename or your file doesn't have an extension you may want to
        // override the automatic detection. You can specify that language here:
        // https://shiki.style/languages
        // lang?: SupportedLanguages;

        // 'diffStyle' controls whether the diff is presented side by side or
        // in a unified (single column) view
        diffStyle: 'split',

        // Line decorators to help highlight changes.
        // 'bars' (default):
        // Shows some red-ish or green-ish (theme dependent) bars on the left
        // edge of relevant lines
        //
        // 'classic':
        // shows '+' characters on additions and '-' characters on deletions
        //
        // 'none':
        // No special diff indicators are shown
        diffIndicators: 'bars',

        // By default green-ish or red-ish background are shown on added and
        // deleted lines respectively. Disable that feature here
        disableBackground: false,

        // Diffs are split up into hunks, this setting customizes what to show
        // between each hunk.
        //
        // 'line-info' (default):
        // Shows a bar that tells you how many lines are collapsed. If you are
        // using the oldFile/newFile API then you can click those bars to
        // expand the content between them
        //
        // 'metadata':
        // Shows the content you'd see in a normal patch file, usually in some
        // format like '@@ -60,6 +60,22 @@'. You cannot use these to expand
        // hidden content
        //
        // 'simple':
        // Just a subtle bar separator between each hunk
        hunkSeparators: 'line-info',

        // On lines that have both additions and deletions, we can run a
        // separate diff check to mark parts of the lines that change.
        // 'none':
        // Do not show these secondary highlights
        //
        // 'char':
        // Show changes at a per character granularity
        //
        // 'word':
        // Show changes but rounded up to word boundaries
        //
        // 'word-alt' (default):
        // Similar to 'word', however we attempt to minimize single character
        // gaps between highlighted changes
        lineDiffType: 'word-alt',

        // If lines exceed these character lengths then we won't perform the
        // line lineDiffType check
        maxLineDiffLength: 1000,

        // If any line in the diff exceeds this value then we won't attempt to
        // syntax highlight the diff
        maxLineLengthForHighlighting: 1000,

        // Enabling this property will hide the file header with file name and
        // diff stats.
        disableFileHeader: false,
      }}
    />
  );
}`;

export function ReactAPI() {
  const [example, setExample] = useState<'file-diff' | 'file'>('file-diff');
  return (
    <section className="space-y-4">
      <h2>React API</h2>
      <p>
        Right now the React API exposes two main components,{' '}
        <code>FileDiff</code> (for rendering diffs for a specific file) and{' '}
        <code>File</code> for rendering just a single code file. We plan to add
        more components like a file picker and tools for virtualization of
        longer diffs in the future.
      </p>
      <p>
        You can import the react components from{' '}
        <code>@pierre/precision-diffs/react</code>
      </p>
      <ButtonGroup
        value={example}
        onValueChange={(value) => setExample(value as 'file-diff' | 'file')}
      >
        <ButtonGroupItem value="file-diff">FileDiff</ButtonGroupItem>
        <ButtonGroupItem value="file">File</ButtonGroupItem>
      </ButtonGroup>
      {example === 'file-diff' ? (
        <SimpleCodeBlock code={CODE} language="tsx" />
      ) : (
        <SimpleCodeBlock code="// Coming Soon" language="tsx" />
      )}
    </section>
  );
}
