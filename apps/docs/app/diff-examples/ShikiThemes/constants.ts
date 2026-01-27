import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const SHIKI_THEMES: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'main.rs',
    contents: `use std::io;

fn main() {
    println!("What is your name?");
    let mut name = String::new();
    io::stdin().read_line(&mut name).unwrap();
    println!("Hello, {}", name.trim());
}

fn add(x: i32, y: i32) -> i32 {
    return x + y;
}
`,
  },
  newFile: {
    name: 'main.rs',
    contents: `use std::io;

fn main() {
    println!("Enter your name:");
    let mut name = String::new();
    io::stdin().read_line(&mut name).expect("read error");
    println!("Hello, {}!", name.trim());
}

fn add(a: i32, b: i32) -> i32 {
    a + b
}
`,
  },
  options: {
    diffStyle: 'split',
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    unsafeCSS: CustomScrollbarCSS,
    enableLineSelection: true,
  },
};
