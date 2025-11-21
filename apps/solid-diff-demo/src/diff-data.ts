import type { FileContents } from '@pierre/precision-diffs';

/**
 * Sample diff data for demonstration purposes.
 * Replace these with your actual file contents when integrating into your app.
 */

export const OLD_FILE: FileContents = {
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

export const NEW_FILE: FileContents = {
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
