import type { PreloadFileDiffOptions } from '@pierre/precision-diffs/ssr';

export const DIFF_STYLES: PreloadFileDiffOptions<undefined> = {
  oldFile: {
    name: 'main.zig',
    contents: `const std = @import("std");
const Allocator = std.heap.page_allocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hi You, {s}!\\n", .{"World"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
}
`,
  },
  newFile: {
    name: 'main.zig',
    contents: `const std = @import("std");
const GeneralPurposeAllocator = std.heap.GeneralPurposeAllocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    var gpa = GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello There, {s}!\\n", .{"Zig"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
    try list.append(42);
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'split',
    overflow: 'wrap',
    disableLineNumbers: false,
  },
};
