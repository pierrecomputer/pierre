import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

export const DIFF_STYLES: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'main.zig',
    contents: `const std = @import("std");
const Allocator = std.heap.page_allocator;
const ArrayList = std.ArrayList;

pub fn main() !void {
    const stdout_writer_instance = std.io.getStdOut().writer();
    try stdout_writer_instance.print("Hi You, {s}! Welcome to our application.\\n", .{"World"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();

    const configuration_options = .{ .enable_logging = true, .max_buffer_size = 1024, .timeout_milliseconds = 5000 };
    _ = configuration_options;
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

    const stdout_writer_instance = std.io.getStdOut().writer();
    try stdout_writer_instance.print("Hello There, {s}! Welcome to the updated Zig application.\\n", .{"Zig"});

    var list = ArrayList(i32).init(allocator);
    defer list.deinit();
    try list.append(42);

    const configuration_options = .{ .enable_logging = true, .max_buffer_size = 2048, .timeout_milliseconds = 10000, .retry_count = 3 };
    _ = configuration_options;
}
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'split',
    overflow: 'wrap',
    disableLineNumbers: false,
    unsafeCSS: CustomScrollbarCSS,
  },
};
