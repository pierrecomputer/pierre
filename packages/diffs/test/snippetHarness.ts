import {
  parseDiffFromFile,
  SnippetFile,
  SnippetFileDiff,
  type SnippetFileDiffOptions,
  type SnippetFileOptions,
} from '../src';
import type { FileContents, FileDiffMetadata } from '../src/types';
import { installDom, waitFor } from './domHarness';

// Shared fixtures and helpers for the snippet tests.

export function numberedLines(length: number): string[] {
  return Array.from({ length }, (_, i) => `line ${i + 1}`);
}

// A `length`-line file (default 40) whose listed one-based lines are modified.
export function makeDiff(
  changedLines: number[],
  length = 40
): FileDiffMetadata {
  const old = numberedLines(length);
  const next = [...old];
  for (const line of changedLines) {
    next[line - 1] = `line ${line} CHANGED`;
  }
  return parseDiffFromFile(
    { name: 'f.txt', contents: old.join('\n') + '\n' },
    { name: 'f.txt', contents: next.join('\n') + '\n' }
  );
}

/**
 * 120 old lines, 119 new. Changes: line 10 modified; old 40-42 replaced by
 * new 40-41 (a modification with 3 removed and 2 added lines, so its split
 * and unified row counts differ); a line inserted at new 60; old 75 removed
 * (between new 74 and 75); old 100 (new 99) modified. Parser context 3, so
 * with range 41-78 the gaps new 45-56 and 64-71 are interior folds.
 */
export function makeMixedDiff(
  context = 3,
  cacheKey = 'mixed'
): FileDiffMetadata {
  const old = numberedLines(120);
  const next = [...old];
  next[99] = 'line 100 CHANGED';
  next.splice(74, 1);
  next.splice(60, 0, 'INSERTED after 60');
  next.splice(39, 3, 'line 40 NEW', 'line 41 NEW');
  next[9] = 'line 10 CHANGED';
  return parseDiffFromFile(
    {
      name: 'f.ts',
      contents: old.join('\n') + '\n',
      cacheKey: `${cacheKey}:old`,
    },
    {
      name: 'f.ts',
      contents: next.join('\n') + '\n',
      cacheKey: `${cacheKey}:new`,
    },
    { context }
  );
}

export function queryAll(container: HTMLElement, selector: string): Element[] {
  return Array.from(container.shadowRoot?.querySelectorAll(selector) ?? []);
}

// Distinct one-based line numbers rendered as rows on one side.
export function renderedLines(
  container: HTMLElement,
  side: 'additions' | 'deletions' | 'any' = 'any'
): number[] {
  const set = new Set<number>();
  for (const node of queryAll(container, '[data-content] [data-line]')) {
    const type = node.getAttribute('data-line-type') ?? '';
    if (side === 'additions' && type === 'change-deletion') continue;
    if (side === 'deletions' && type === 'change-addition') continue;
    set.add(Number(node.getAttribute('data-line')));
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * New-side and old-side line numbers, read so unified and split compare:
 * `del` holds removed lines (old numbers), `add` every other row's new
 * number (context rows carry new numbers in unified, both sides in split).
 */
export function sideLines(container: HTMLElement): {
  add: number[];
  del: number[];
} {
  const add = new Set<number>();
  const del = new Set<number>();
  for (const node of queryAll(container, '[data-content] [data-line]')) {
    const type = node.getAttribute('data-line-type') ?? '';
    const line = Number(node.getAttribute('data-line'));
    if (type === 'change-deletion') del.add(line);
    else if (node.closest('[data-deletions]') == null) add.add(line);
  }
  const sort = (set: Set<number>) => [...set].sort((a, b) => a - b);
  return { add: sort(add), del: sort(del) };
}

// The fold labels in document order, read from the first rendered column.
export function foldLabels(container: HTMLElement): string[] {
  const code = queryAll(container, '[data-code]')[0];
  return Array.from(
    code?.querySelectorAll('[data-content] [data-unmodified-lines]') ?? []
  ).map((node) => node.textContent ?? '');
}

/**
 * What each boundary separator in the first column shows, in document order:
 * its label, the text of its change pills (removed first), the pills' data
 * attributes and the pill group's accessible name.
 */
export function boundarySummaries(container: HTMLElement): {
  boundary: string | null;
  label: string;
  pills: string[];
  kinds: string[];
  name: string | null;
}[] {
  const code = queryAll(container, '[data-code]')[0];
  return Array.from(
    code?.querySelectorAll('[data-content] [data-snippet-boundary]') ?? []
  ).map((separator) => {
    const group = separator.querySelector('[data-snippet-change-counts]');
    const pills = Array.from(group?.children ?? []);
    return {
      boundary: separator.getAttribute('data-snippet-boundary'),
      label:
        separator.querySelector('[data-unmodified-lines]')?.textContent ?? '',
      pills: pills.map((pill) => pill.textContent ?? ''),
      kinds: pills.map((pill) =>
        pill.hasAttribute('data-snippet-deletions-count')
          ? 'deletions'
          : pill.hasAttribute('data-snippet-additions-count')
            ? 'additions'
            : 'unknown'
      ),
      name: group?.getAttribute('aria-label') ?? null,
    };
  });
}

// The boundary separator elements of one side, across every column.
export function boundaries(
  container: HTMLElement,
  boundary: 'above' | 'below'
): Element[] {
  return queryAll(container, `[data-snippet-boundary="${boundary}"]`);
}

// Interior (base hunk) separator labels in the first column.
export function interiorLabels(container: HTMLElement): Element[] {
  const code = queryAll(container, '[data-code]')[0];
  return Array.from(
    code?.querySelectorAll(
      '[data-content] [data-separator]:not([data-snippet-boundary]) [data-unmodified-lines]'
    ) ?? []
  );
}

// A real click, the path a reader's click takes through the DOM listeners.
export function click(
  element: Element | null | undefined,
  { shiftKey = false }: { shiftKey?: boolean } = {}
): void {
  if (element == null) {
    throw new Error('click: no element');
  }
  element.dispatchEvent(
    new window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      composed: true,
      shiftKey,
    })
  );
}

// The clickable label of the boundary fold, in the first column.
export function boundaryLabel(
  container: HTMLElement,
  boundary: 'above' | 'below'
): Element | undefined {
  return queryAll(
    container,
    `[data-gutter] [data-snippet-boundary="${boundary}"] [data-unmodified-lines]`
  )[0];
}

interface Mounted<T> {
  instance: T;
  container: HTMLElement;
}

async function withMounted<T extends { cleanUp(): void }>(
  mount: () => T,
  render: (mounted: Mounted<T>) => void,
  body: (mounted: Mounted<T>) => Promise<void> | void
): Promise<void> {
  const { cleanup } = installDom();
  let instance: T | undefined;
  try {
    const container = document.createElement('div');
    document.body.append(container);
    instance = mount();
    const mounted = { instance, container };
    render(mounted);
    await waitFor(() => container.shadowRoot?.querySelector('code') != null);
    await body(mounted);
  } finally {
    instance?.cleanUp();
    cleanup();
  }
}

export async function withSnippetDiff<LAnnotation = undefined>(
  options: Partial<SnippetFileDiffOptions<LAnnotation>>,
  body: (
    mounted: Mounted<SnippetFileDiff<LAnnotation>>
  ) => Promise<void> | void,
  fileDiff: FileDiffMetadata = makeDiff([5, 30])
): Promise<void> {
  await withMounted(
    () =>
      new SnippetFileDiff<LAnnotation>({
        disableFileHeader: true,
        diffStyle: 'unified',
        lineRange: { start: 25, end: 35 },
        ...options,
      }),
    ({ instance, container }) =>
      instance.render({ fileContainer: container, fileDiff }),
    body
  );
}

export const FIFTY_LINES: FileContents = {
  name: 'f.txt',
  contents: numberedLines(50).join('\n'),
};

export async function withSnippetFile<LAnnotation = undefined>(
  options: Partial<SnippetFileOptions<LAnnotation>>,
  body: (mounted: Mounted<SnippetFile<LAnnotation>>) => Promise<void> | void,
  file: FileContents = FIFTY_LINES
): Promise<void> {
  await withMounted(
    () =>
      new SnippetFile<LAnnotation>({
        disableFileHeader: true,
        lineRange: { start: 20, end: 25 },
        ...options,
      }),
    ({ instance, container }) =>
      instance.render({ fileContainer: container, file }),
    body
  );
}

export const STYLES = ['unified', 'split'] as const;
