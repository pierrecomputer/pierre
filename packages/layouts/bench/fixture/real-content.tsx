import { FileDiff, parseDiffFromFile } from '@pierre/diffs';
import { FileTree } from '@pierre/trees';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { type JSX, useEffect, useRef } from 'react';

// Sizes for real content: in the range of a long agent session.
const TERMINAL_LINES = 5000;
const DIFF_LINES = 1500;
const TREE_PATHS = 5000;

const WORDS = [
  'layout',
  'pane',
  'commit',
  'branch',
  'render',
  'agent',
  'diff',
  'terminal',
];

function word(seed: number): string {
  return WORDS[(seed * 2654435761) % WORDS.length];
}

/** A real terminal emulator that refits its rows and columns when its pane changes size. */
export function RealTerminal(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const terminal = new Terminal({ scrollback: TERMINAL_LINES, fontSize: 12 });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    const lines: string[] = [];
    for (let index = 0; index < TERMINAL_LINES; index++) {
      lines.push(
        `\u001b[32m$\u001b[0m ${word(index)} ${word(index + 1)} \u001b[90m${word(index + 2)} ${index}\u001b[0m`
      );
    }
    terminal.write(lines.join('\r\n'));
    fit.fit();
    // A terminal in an agent app refits on each size change, as xterm's fit add-on does.
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    return () => {
      observer.disconnect();
      terminal.dispose();
    };
  }, []);
  return <div ref={ref} className="bench-real-terminal" />;
}

function source(changed: boolean): string {
  const lines: string[] = [];
  for (let index = 0; index < DIFF_LINES; index++) {
    const edit = changed && index % 7 === 0;
    lines.push(
      `export const ${word(index)}${index} = '${edit ? word(index + 3) : word(index + 1)}';`
    );
  }
  return lines.join('\n');
}

/** A large highlighted diff from `@pierre/diffs`. */
export function RealDiff(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const fileDiff = parseDiffFromFile(
      { name: 'src/values.ts', contents: source(false) },
      { name: 'src/values.ts', contents: source(true) }
    );
    const view = new FileDiff({ diffStyle: 'split', theme: 'pierre-dark' });
    // The view creates its own `diffs-container` element, which holds its styles.
    view.render({ containerWrapper: element, fileDiff });
    return () => view.cleanUp();
  }, []);
  return <div ref={ref} className="bench-real-diff" />;
}

/** A large file tree from `@pierre/trees`, fully expanded. */
export function RealTree(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const paths: string[] = [];
    for (let index = 0; index < TREE_PATHS; index++) {
      paths.push(
        `src/${word(index)}/${word(index + 1)}/${word(index + 2)}-${index}.ts`
      );
    }
    const tree = new FileTree({ paths, initialExpansion: 'open' });
    tree.render({ containerWrapper: element });
    return () => tree.cleanUp();
  }, []);
  return <div ref={ref} className="bench-real-tree" />;
}
