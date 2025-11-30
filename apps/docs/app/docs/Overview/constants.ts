import type {
  PreloadFileOptions,
  PreloadMultiFileDiffOptions,
} from '@pierre/precision-diffs/ssr';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
} as const;

export const OVERVIEW_INITIAL_EXAMPLE: PreloadMultiFileDiffOptions<undefined> =
  {
    oldFile: {
      name: 'main.zig',
      contents: `const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi you, {s}!\\n", .{"world"});
}
`,
    },
    newFile: {
      name: 'main.zig',
      contents: `const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello there, {s}!\\n", .{"zig"});
}
`,
    },
    options: {
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      diffStyle: 'split',
      diffIndicators: 'bars',
      overflow: 'wrap',
    },
  };

export const OVERVIEW_REACT_SINGLE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'react_single_file.tsx',
    contents: `import {
  type FileContents,
  FileDiff,
} from '@pierre/precision-diffs/react';

const oldFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi you, {s}!\\\\\\\\n", .{"world"});
}
\`,
};

const newFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello there, {s}!\\\\\\\\n", .{"zig"});
}
\`,
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
      options={{ theme: 'pierre-dark' }}
    />
  );
}`,
  },
  options,
};

export const OVERVIEW_REACT_PATCH_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'react_patch_file.tsx',
    contents: `import {
  type ParsedPatch,
  FileDiff,
  parsePatchFiles,
} from '@pierre/precision-diffs/react';

// If you consume a patch file, then you'll need to spawn multiple
// renderers for each file in the patches
function Patches() {
  const [parsedPatches, setParsedPatches] = useState<ParsedPatch[]>([]);
  useEffect(() => {
    // This is a fake function to fetch a github pr patch file, not an
    // actual api
    fetchGithubPatch('https://github.com/twbs/bootstrap/pull/41766.patch')
      .then(
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
            // Under the hood, all instances of FileDiff will use a
            // shared Shiki highlighter and manage loading languages
            // and themes for you
            <FileDiff
              key={index}
              // 'fileDiff' is a data structure that includes all
              // hunks for a specific file from a patch
              fileDiff={fileDiff}
              options={{
                // Automatically theme based on users OS settings
                theme: { dark: 'pierre-dark', light: 'pierre-light' },
              }}
            />
          ))}
        </Fragment>
      ))}
    </>
  );
}`,
  },
  options,
};

export const OVERVIEW_VANILLA_SINGLE_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla_single_file.ts',
    contents: `import {
  type FileContents,
  FileDiff,
} from '@pierre/precision-diffs';

// Comparing two files
const oldFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi you, {s}!\\\\\\\\n", .{"world"});
}
\`,
};

const newFile: FileContents = {
  name: 'main.zig',
  contents: \`const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello there, {s}!\\\\\\\\n", .{"zig"});
}
\`,
};

// We automatically detect the language based on the filename
// You can also provide a lang property when instantiating FileDiff.
const fileDiffInstance = new FileDiff({ theme: 'pierre-dark' });

// Render is awaitable if you need that
await fileDiffInstance.render({
  oldFile,
  newFile,
  // where to render the diff into
  containerWrapper: document.body,
});`,
  },
  options,
};

export const OVERVIEW_VANILLA_PATCH_FILE: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla_patch_file.ts',
    contents: `import {
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
    // 'fileDiff' is a data structure that includes all hunks for a
    // specific file from a patch
    const instance = new FileDiff({
      // Automatically theme based on users os settings
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
    });
    // Under the hood, all instances of FileDiff will use a shared
    // Shiki highlighter and manage loading languages and themes for
    // you automatically
    instance.render({
      fileDiff,
      containerWrapper: document.body,
    });
  }
}`,
  },
  options,
};
