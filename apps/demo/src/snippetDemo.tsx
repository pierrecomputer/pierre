import {
  DIFFS_TAG_NAME,
  type FileDiffMetadata,
  parseDiffFromFile,
  type SnippetExpandEvent,
  SnippetFile,
  SnippetFileDiff,
  type SnippetFold,
  type SnippetFolds,
} from '@pierre/diffs';
import {
  SnippetFile as ReactSnippetFile,
  SnippetFileDiff as ReactSnippetFileDiff,
} from '@pierre/diffs/react';
import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// Snippet demo: a range of a diff or file with edge folds that open in
// place, once with the built-in separators and once with host-drawn edge
// markup. Inside the range, folds are ordinary hunk separators (lines 52-57
// fold between the changes at 48 and 61).

// Hides the built-in above/below separators; interior folds keep theirs.
const HIDE_BOUNDARY_CSS = '[data-snippet-boundary] { display: none; }';

function makeSource(changed: boolean): string {
  const lines: string[] = [];
  for (let i = 1; i <= 120; i++) {
    const edited = changed && (i === 12 || i === 48 || i === 61 || i === 95);
    lines.push(
      edited
        ? `export const value${i} = compute(${i}, 'changed');`
        : `export const value${i} = compute(${i});`
    );
  }
  return lines.join('\n') + '\n';
}

const OLD = { name: 'values.ts', contents: makeSource(false) };
const NEW = { name: 'values.ts', contents: makeSource(true) };
const DIFF: FileDiffMetadata = parseDiffFromFile(OLD, NEW);

// A small, realistic file for the compact snippet: one change hidden
// above the range (line 4) and one modified line inside it (line 17).
const CART_LINES = [
  "import { formatCurrency } from './format';",
  "import type { CartItem } from './types';",
  '',
  'const TAX_RATE = 0.08;',
  'const FREE_SHIPPING_MIN = 50;',
  '',
  'export function subtotal(items: CartItem[]): number {',
  '  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);',
  '}',
  '',
  'export function shipping(base: number): number {',
  '  return base >= FREE_SHIPPING_MIN ? 0 : 5.99;',
  '}',
  '',
  'export function cartTotal(items: CartItem[], discount = 0): string {',
  '  const base = subtotal(items);',
  '  const discounted = base - discount;',
  '  const total = discounted * (1 + TAX_RATE) + shipping(base);',
  '  return formatCurrency(total);',
  '}',
  '',
  'export function itemCount(items: CartItem[]): number {',
  '  return items.reduce((count, item) => count + item.quantity, 0);',
  '}',
  '',
  'export function isEmpty(items: CartItem[]): boolean {',
  '  return items.length === 0;',
  '}',
];
const CART_OLD = { name: 'cart.ts', contents: CART_LINES.join('\n') + '\n' };
const CART_NEW = {
  name: 'cart.ts',
  contents:
    CART_LINES.map((line, index) =>
      index === 3
        ? 'const TAX_RATE = 0.0825;'
        : index === 16
          ? '  const discounted = Math.max(base - discount, 0);'
          : line
    ).join('\n') + '\n',
};
const CART_DIFF: FileDiffMetadata = parseDiffFromFile(CART_OLD, CART_NEW);

function section(container: HTMLElement, title: string): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.dataset.snippetDemo = title;
  wrapper.style.cssText = 'margin-block:16px;font:13px system-ui,sans-serif';
  const heading = document.createElement('h3');
  heading.textContent = title;
  wrapper.append(heading);
  container.append(wrapper);
  return wrapper;
}

function logFold(log: HTMLElement, { fold, lineCount }: SnippetExpandEvent) {
  const entry = document.createElement('div');
  const span =
    fold.lineRange != null
      ? ` (lines ${fold.lineRange.start}-${fold.lineRange.end})`
      : '';
  entry.textContent = `onSnippetExpand: ${fold.boundary}${span}, ${fold.hiddenLines} hidden${fold.containsChanges ? ` (-${fold.hiddenDeletions} +${fold.hiddenAdditions})` : ''}, asks for ${lineCount}`;
  log.append(entry);
}

// The text a host bar shows for one side: how much is hidden there and,
// with the same "-D +A" counts as the built-in pills, whether it includes
// changes.
function describeFold(
  boundary: 'above' | 'below',
  fold: SnippetFold | undefined
): string {
  if (fold == null) return `Nothing hidden ${boundary}`;
  const n = fold.hiddenLines;
  const plural = n === 1 ? '' : 's';
  if (!fold.containsChanges) {
    return `${n} unmodified line${plural} hidden ${boundary}`;
  }
  const counts = [
    fold.hiddenDeletions > 0 ? `-${fold.hiddenDeletions}` : '',
    fold.hiddenAdditions > 0 ? `+${fold.hiddenAdditions}` : '',
  ].filter((count) => count !== '');
  return `${n} line${plural} hidden ${boundary}, includes changes ${counts.join(' ')}`;
}

const HOST_BAR_STYLE =
  'display:flex;gap:8px;align-items:center;padding:4px 8px;border:1px dashed currentcolor;border-radius:6px';

// A host-drawn bar outside the component that grows the snippet in place.
// update() redraws it from getSnippetFolds().
function hostBar(
  boundary: 'above' | 'below',
  expand: (boundary: 'above' | 'below', lineCount?: number) => boolean
): { bar: HTMLElement; update(folds: SnippetFolds): void } {
  const bar = document.createElement('div');
  bar.dataset.hostSnippetBar = boundary;
  bar.style.cssText = HOST_BAR_STYLE;
  const label = document.createElement('span');
  label.dataset.hostSnippetLabel = '';
  // Screen readers hear the new count after a reveal.
  label.setAttribute('aria-live', 'polite');
  bar.append(label);
  const buttons: HTMLButtonElement[] = [];
  for (const [text, count] of [
    ['Show 20 more lines', 20],
    ['Show all', Infinity],
  ] as const) {
    const button = document.createElement('button');
    button.textContent = text;
    // Two bars share the button texts; the name says which side.
    button.setAttribute('aria-label', `${text} ${boundary}`);
    button.addEventListener('click', () => expand(boundary, count));
    buttons.push(button);
    bar.append(button);
  }
  return {
    bar,
    update(folds) {
      const fold = folds[boundary];
      label.textContent = describeFold(boundary, fold);
      for (const button of buttons) button.disabled = fold == null;
    },
  };
}

export interface SnippetDemo {
  cleanUp(): void;
}

export function renderSnippetDemo(
  container: HTMLElement,
  diffStyle: 'unified' | 'split'
): SnippetDemo {
  const cleanups: (() => void)[] = [];

  // 0. Compact: the cartTotal function (lines 15-20) with the default
  //    boundary separators; the change at line 4 is behind the fold above.
  const compact = section(container, 'Compact SnippetFileDiff, lines 15-20');
  // Sized to the code so the shot stays tight; split needs two columns.
  compact.style.maxWidth = diffStyle === 'split' ? '1280px' : '720px';
  const compactDiff = new SnippetFileDiff({
    diffStyle,
    lineRange: { start: 15, end: 20 },
  });
  const compactContainer = document.createElement(DIFFS_TAG_NAME);
  compact.append(compactContainer);
  compactDiff.render({ fileDiff: CART_DIFF, fileContainer: compactContainer });
  cleanups.push(() => compactDiff.cleanUp());

  // 0b. The same lines of the new cart.ts as a plain file: SnippetFile
  //     shows lines 15-20 with folds above and below.
  const compactFile = section(container, 'Compact SnippetFile, lines 15-20');
  compactFile.style.maxWidth = '720px';
  const compactSnippetFile = new SnippetFile({
    lineRange: { start: 15, end: 20 },
  });
  const compactFileContainer = document.createElement(DIFFS_TAG_NAME);
  compactFile.append(compactFileContainer);
  compactSnippetFile.render({
    file: CART_NEW,
    fileContainer: compactFileContainer,
  });
  cleanups.push(() => compactSnippetFile.cleanUp());

  // 1. Built-in separators with a telemetry log (the callback does not call
  //    preventDefault, so the built-in reveal still runs).
  const builtIn = section(container, 'SnippetFileDiff, lines 40-70');
  const log = document.createElement('div');
  log.dataset.snippetLog = '';
  const builtInDiff = new SnippetFileDiff({
    diffStyle,
    lineRange: { start: 40, end: 70 },
    expansionLineCount: 10,
    onSnippetExpand: (event) => logFold(log, event),
  });
  const builtInContainer = document.createElement(DIFFS_TAG_NAME);
  builtIn.append(builtInContainer, log);
  builtInDiff.render({ fileDiff: DIFF, fileContainer: builtInContainer });
  cleanups.push(() => builtInDiff.cleanUp());

  // 2. Host edge markup: built-in boundary separators hidden; host bars
  //    show getSnippetFolds() counts and drive expandSnippet.
  const host = section(container, 'SnippetFileDiff with host edge markup');
  const expand = (boundary: 'above' | 'below', lineCount?: number) =>
    hostDiff.expandSnippet(boundary, lineCount);
  const above = hostBar('above', expand);
  const below = hostBar('below', expand);
  const hostDiff = new SnippetFileDiff({
    diffStyle,
    lineRange: { start: 40, end: 70 },
    unsafeCSS: HIDE_BOUNDARY_CSS,
    // Every render (including the one after a reveal) redraws the bars;
    // at unmount there is nothing left to draw.
    onPostRender: (_node, instance, phase) => {
      if (phase === 'unmount') return;
      const folds = instance.getSnippetFolds();
      above.update(folds);
      below.update(folds);
    },
  });
  const hostContainer = document.createElement(DIFFS_TAG_NAME);
  host.append(above.bar, hostContainer, below.bar);
  hostDiff.render({ fileDiff: DIFF, fileContainer: hostContainer });
  cleanups.push(() => hostDiff.cleanUp());

  // 3. Identical files: a diff without hunks shows its range as plain
  //    lines between the two edge folds.
  const identical = section(container, 'SnippetFileDiff of identical files');
  const identicalDiff = new SnippetFileDiff({
    diffStyle,
    lineRange: { start: 40, end: 50 },
  });
  const identicalContainer = document.createElement(DIFFS_TAG_NAME);
  identical.append(identicalContainer);
  identicalDiff.render({
    fileDiff: parseDiffFromFile(OLD, { ...OLD }),
    fileContainer: identicalContainer,
  });
  cleanups.push(() => identicalDiff.cleanUp());

  // 4. React: SnippetFileDiff with built-in and host edge markup, then
  //    SnippetFile.
  const reactSection = section(
    container,
    'React SnippetFileDiff and SnippetFile'
  );
  const root = createRoot(
    reactSection.appendChild(document.createElement('div'))
  );
  root.render(<ReactSnippets diffStyle={diffStyle} />);
  cleanups.push(() => root.unmount());

  return {
    cleanUp() {
      for (const cleanUp of cleanups.splice(0)) cleanUp();
    },
  };
}

// A host-drawn edge bar in React, fed by getSnippetFolds().
function ReactHostBar({
  boundary,
  fold,
  expand,
}: {
  boundary: 'above' | 'below';
  fold: SnippetFold | undefined;
  expand: (boundary: 'above' | 'below', lineCount: number) => void;
}) {
  return (
    <div
      data-host-snippet-bar={boundary}
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        padding: '4px 8px',
        border: '1px dashed currentcolor',
        borderRadius: 6,
      }}
    >
      <span aria-live="polite">{describeFold(boundary, fold)}</span>
      <button
        disabled={fold == null}
        aria-label={`Show 5 more lines ${boundary}`}
        onClick={() => expand(boundary, 5)}
      >
        Show 5 more lines
      </button>
      <button
        disabled={fold == null}
        aria-label={`Show all ${boundary}`}
        onClick={() => expand(boundary, Infinity)}
      >
        Show all
      </button>
    </div>
  );
}

function ReactSnippets({ diffStyle }: { diffStyle: 'unified' | 'split' }) {
  const [log, setLog] = useState<string[]>([]);
  // The instance arrives through onPostRender; keep it for expandSnippet,
  // and read its folds after every render for the host bars.
  const hostRef = useRef<SnippetFileDiff | null>(null);
  const [folds, setFolds] = useState<SnippetFolds>({});
  const hostOptions = useMemo(
    () => ({
      diffStyle,
      lineRange: { start: 20, end: 30 },
      unsafeCSS: HIDE_BOUNDARY_CSS,
      onPostRender: (
        _node: HTMLElement,
        instance: SnippetFileDiff,
        phase: string
      ) => {
        if (phase === 'unmount') return;
        hostRef.current = instance;
        const next = instance.getSnippetFolds();
        setFolds((prev) =>
          JSON.stringify(prev) === JSON.stringify(next) ? prev : next
        );
      },
    }),
    [diffStyle]
  );
  const expand = (boundary: 'above' | 'below', lineCount: number) => {
    hostRef.current?.expandSnippet(boundary, lineCount);
  };
  return (
    <>
      <ReactSnippetFileDiff
        fileDiff={DIFF}
        options={{
          diffStyle,
          lineRange: { start: 90, end: 100 },
          onSnippetExpand: ({ fold, lineCount }) =>
            setLog((entries) => [
              ...entries,
              `${fold.boundary}: ${fold.hiddenLines} hidden, asks for ${lineCount}`,
            ]),
        }}
      />
      <div data-snippet-log="react">
        {log.map((entry, index) => (
          <div key={index}>onSnippetExpand: {entry}</div>
        ))}
      </div>
      <h4>React SnippetFileDiff with host edge markup, lines 20-30</h4>
      <ReactHostBar boundary="above" fold={folds.above} expand={expand} />
      <ReactSnippetFileDiff fileDiff={DIFF} options={hostOptions} />
      <ReactHostBar boundary="below" fold={folds.below} expand={expand} />
      <h4>React SnippetFile, lines 15-20</h4>
      <div style={{ maxWidth: 720 }}>
        <ReactSnippetFile
          file={CART_NEW}
          options={{ lineRange: { start: 15, end: 20 } }}
        />
      </div>
    </>
  );
}
