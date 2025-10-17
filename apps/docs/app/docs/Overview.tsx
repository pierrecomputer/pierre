import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';
import { IconCiWarningFill } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import Link from 'next/link';
import { useState } from 'react';

import type { DocsExampleTypes } from './types';

const CODE_VANILLA_SINGLE_FILE = `import {
  type FileContents,
  FileDiff,
} from '@pierre/precision-diffs';

// Comparing two files
const oldFile: FileContents = {
  name: 'filename.ts',
  contents: 'console.log("Hello world")',
};

const newFile: FileContents = {
  name: 'filename.ts',
  contents: 'console.warn("Uh oh")',
};

// We automatically detect the language based on the filename
// You can also provide a lang property when instantiating FileDiff.
const fileDiffInstance = new FileDiff({ theme: 'pierre-night' });

// Render is awaitable if you need that
await fileDiffInstance.render({
  oldFile,
  newFile,
  // where to render the diff into
  containerWrapper: document.body,
});`;

const CODE_VANILLA_PATCH_FILE = `import {
  FileDiff,
  ParsedPatch,
  parsePatchFiles,
} from '@pierre/precision-diffs';

// This is a fake function to fetch a GitHub PR patch file,
// not an actual api
const patchFileContent: string = await fetchGithubPatch(
  'https://github.com/twbs/bootstrap/pull/41766.patch'
);

// Github can return multiple patches in 1 file, we handle all of this
// automatically for you. Just give us a single patch or any number
const parsedPatches: ParsedPatch[] = parsePatchFiles(patchFileContent);
for (const patch of parsedPatches) {
  for (const fileDiff of patch.files) {
    // 'fileDiff' is a data structure that includes all hunks for a specific
    // file from a patch
    const instance = new FileDiff({
      // Automatically theme based on users os settings
      themes: { dark: 'pierre-night', light: 'pierre-light' },
    });
    // Under the hood, all instances of FileDiff will use a shared Shiki
    // highlighter and manage loading languages and themes for you automatically
    instance.render({
      fileDiff,
      containerWrapper: document.body,
    });
  }
}`;

const CODE_REACT_SINGLE_FILE = `import {
  type FileContents,
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

// Comparing two files
function SingleDiff() {
  return (
    <FileDiff
      // We automatically detect the language based on filename
      // You can also provide 'lang' property in 'options' when
      // rendering FileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{ theme: 'pierre-night' }}
    />
  );
}`;

const CODE_REACT_PATCH_FILE = `import {
  type ParsedPatch,
  FileDiff,
  parsePatchFiles,
} from '@pierre/precision-diffs/react';

// If you consume a patch file, then you'll need to spawn multiple renderers
// for each file in the patches
function Patches() {
  const [parsedPatches, setParsedPatches] = useState<ParsedPatch[]>([]);
  useEffect(() => {
    // This is a fake function to fetch a github pr patch file, not an actual api
    fetchGithubPatch('https://github.com/twbs/bootstrap/pull/41766.patch').then(
      (data: string) => {
        setParsedPatches(
          // Github can return multiple patches in 1 file, we handle all
          // of this automatically for you. Just give us a single patch
          // or any number
          parsePatchFiles(data)
        );
      }
    );
  }, []);

  return (
    <>
      {parsePatchFiles.map((patch, index) => (
        <Fragment key={index}>
          {patch.files.map((fileDiff, index) => (
            // Under the hood, all instances of FileDiff will use a shared Shiki
            // highlighter and manage loading languages and themes for you
            <FileDiff
              key={index}
              // 'fileDiff' is a data structure that includes all hunks for a
              // specific file from a patch
              fileDiff={fileDiff}
              options={{
                // Automatically theme based on users OS settings
                themes: { dark: 'pierre-night', light: 'pierre-light' },
              }}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}`;

interface OverviewProps {
  exampleType: DocsExampleTypes;
  setExampleType(type: DocsExampleTypes): unknown;
}

export function Overview({ exampleType, setExampleType }: OverviewProps) {
  const [example, setExample] = useState<'single-file' | 'patch-file'>(
    'single-file'
  );
  return (
    <section className="space-y-4">
      <h2>Overview</h2>
      <p className="flex gap-2 text-sm bg-cyan-500/10 border border-cyan-500/20 px-5 py-4 rounded-md text-cyan-600 dark:text-cyan-300">
        <IconCiWarningFill className="mt-[2px]" />
        Precision Diffs is in early active development—many of these APIs are
        subject to change.
      </p>
      <p>
        <strong>Precision Diffs</strong> is a library for rendering code and
        diffs on the web. This includes both high level easy-to-use components
        as well as exposing many of the internals if you want to selectively use
        specific pieces. We’ve built syntax highlighting on top of{' '}
        <Link href="https://shiki.dev" target="_blank">
          Shiki
        </Link>{' '}
        which provides a lot of great theme and language support.
      </p>
      <p>
        We have an opinionated stance in our architecture:{' '}
        <strong>browsers are rather efficient at rendering raw HTML</strong>. We
        lean into this by having all the lower level APIs purely rendering
        strings (the raw HTML) that are then consumed by higher-order components
        and utilities. This gives us great performance and flexibility to
        support popular libraries like React as well as provide great tools if
        you want to stick to vanilla JavaScript and HTML. The higher-order
        components render all this out into Shadow DOM and CSS grid layout.
      </p>
      <p>
        Generally speaking, you’re probably going to want to use the higher
        level components since they provide an easy-to-use API that you can get
        started with rather quickly. We currently only have components for
        vanilla JavaScript and React, but will add more if there’s demand.
      </p>
      <p>
        For this overview, we’ll talk about the vanilla JavaScript components
        for now but there are React equivalents for all of these.
      </p>
      <h3>Rendering Diffs</h3>
      <p>
        It’s in the name, it’s probably why you’re here. Our goal with
        visualizing diffs was to provide some flexible and easy to use APIs for{' '}
        <em>how</em> you might want to render diffs. For this we provide a
        component called <code>FileDiff</code> (available in both JavaScript and
        React versions).
      </p>
      <p>
        There are two ways to render diffs with <code>FileDiff</code>:
      </p>
      <ol>
        <li>Provide two versions of a file or code to compare</li>
        <li>Consume a patch file</li>
      </ol>
      <p>
        You can see examples of both these approaches below, in both JavaScript
        and React.
      </p>
      <div className="flex gap-2">
        <ButtonGroup
          value={exampleType}
          onValueChange={(value) =>
            setExampleType(value as 'vanilla' | 'react')
          }
        >
          <ButtonGroupItem value="vanilla">Vanilla JS</ButtonGroupItem>
          <ButtonGroupItem value="react">React</ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup
          value={example}
          onValueChange={(value) =>
            setExample(value as 'single-file' | 'patch-file')
          }
        >
          <ButtonGroupItem value="single-file">Single file</ButtonGroupItem>
          <ButtonGroupItem value="patch-file">Patch file</ButtonGroupItem>
        </ButtonGroup>
      </div>
      {exampleType === 'react' ? (
        <>
          {example === 'single-file' ? (
            <SimpleCodeBlock
              code={CODE_REACT_SINGLE_FILE}
              language="typescript"
            />
          ) : (
            <SimpleCodeBlock
              code={CODE_REACT_PATCH_FILE}
              language="typescript"
            />
          )}
        </>
      ) : (
        <>
          {example === 'single-file' ? (
            <SimpleCodeBlock
              code={CODE_VANILLA_SINGLE_FILE}
              language="typescript"
            />
          ) : (
            <SimpleCodeBlock
              code={CODE_VANILLA_PATCH_FILE}
              language="typescript"
            />
          )}
        </>
      )}
    </section>
  );
}
