import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

export const FONT_STYLES: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'hello.ts',
    contents: `function greet(name) {
  return "Hello, " + name + "!";
}

const message = greet("World");
console.log(message);
`,
  },
  newFile: {
    name: 'hello.ts',
    contents: `function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

const message: string = greet("World");
console.log(message);

export { greet };
`,
  },
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
  },
};
