import { type DiffLineAnnotation, type FileContents } from '@pierre/diffs';
import { preloadMultiFileDiff } from '@pierre/diffs/ssr';

import type { AnnotationMetadata } from './ssr_types';
import { SSRPage } from './SSRPage';

const OLD_FILE: FileContents = {
  name: 'main.zig',
  contents: `const std = @import("std");
const allocator = std.heap.page_allocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello, {s}!\\n", .{"World"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
}
`,
};

const NEW_FILE: FileContents = {
  name: 'main.zig',
  contents: `const std = @import("std");
const GeneralPurposeAllocator = std.heap.GeneralPurposeAllocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    var gpa = GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello, {s}!\\n", .{"Zig"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
    try list.append(42);
}
`,
};

// Define annotation positions once in the server component
const annotations: DiffLineAnnotation<AnnotationMetadata>[] = [
  {
    side: 'additions',
    lineNumber: 8,
    metadata: {
      message: 'There was a sneaky lil error on this line in CI.',
    },
  },
];

export default async function Ssr() {
  const preloadedFileDiff = await preloadMultiFileDiff<AnnotationMetadata>({
    oldFile: OLD_FILE,
    newFile: NEW_FILE,
    options: {
      theme: 'pierre-dark',
      diffStyle: 'split',
      diffIndicators: 'bars',
      overflow: 'scroll',
    },
    annotations,
  });

  return <SSRPage preloadedFileDiff={preloadedFileDiff} />;
}
