import { type JSX, useEffect, useRef, useState } from 'react';

export type ContentWeight = 'light' | 'heavy';
export type ContentKind = 'terminal' | 'diff' | 'tree' | 'chat';

const KINDS: readonly ContentKind[] = ['terminal', 'diff', 'tree', 'chat'];

// Sizes for heavy content. Each heavy pane holds about 3,500 to 5,600 elements,
// in the range of a real terminal scrollback, a large diff, or a monorepo tree.
const TERMINAL_LINES = 1200;
const DIFF_ROWS = 800;
const TREE_NODES = 1200;
const CHAT_MESSAGES = 80;

const WORDS = [
  'layout',
  'pane',
  'commit',
  'branch',
  'render',
  'agent',
  'diff',
  'terminal',
  'review',
  'session',
  'cursor',
  'buffer',
  'compile',
  'module',
  'request',
  'deploy',
];

/** Per-pane counts that the benchmark reads after each operation. */
export const counters: {
  renders: Map<string, number>;
  resizeCallbacks: Map<string, number>;
} = {
  renders: new Map<string, number>(),
  resizeCallbacks: new Map<string, number>(),
};

const appendListeners = new Map<string, () => void>();

function bump(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1);
}

export function resetCounters(): void {
  counters.renders.clear();
  counters.resizeCallbacks.clear();
}

/** Add output to a pane, as a terminal or an agent chat does while it streams. */
export function appendTo(id: string): void {
  appendListeners.get(id)?.();
}

// A small deterministic generator, so that every run renders the same text.
function words(seed: number, count: number): string {
  let value = seed * 2654435761;
  const out: string[] = [];
  for (let index = 0; index < count; index++) {
    value = (value * 1103515245 + 12345) >>> 0;
    out.push(WORDS[value % WORDS.length]);
  }
  return out.join(' ');
}

function Terminal({ extra }: { extra: number }): JSX.Element {
  const lines = [];
  for (let index = 0; index < TERMINAL_LINES + extra; index++) {
    lines.push(
      <div key={index} className="bench-term-line">
        <span className="bench-term-prompt">$</span>{' '}
        <span className="bench-term-command">{words(index, 3)}</span>{' '}
        <span className="bench-term-output">{words(index + 7, 6)}</span>
      </div>
    );
  }
  return <div className="bench-terminal">{lines}</div>;
}

function Diff(): JSX.Element {
  const rows = [];
  for (let index = 0; index < DIFF_ROWS; index++) {
    const change = index % 7 === 0 ? 'add' : index % 11 === 0 ? 'del' : 'ctx';
    rows.push(
      <div key={index} className={`bench-diff-row bench-diff-${change}`}>
        <span className="bench-diff-number">{index + 1}</span>
        <span className="bench-diff-number">{index + 3}</span>
        <span className="bench-diff-code">
          <span className="bench-token-keyword">const</span>{' '}
          <span className="bench-token-name">{words(index, 1)}</span> ={' '}
          <span className="bench-token-string">{`'${words(index + 3, 4)}'`}</span>
        </span>
      </div>
    );
  }
  return <div className="bench-diff">{rows}</div>;
}

function Tree(): JSX.Element {
  const nodes = [];
  for (let index = 0; index < TREE_NODES; index++) {
    nodes.push(
      <li
        key={index}
        className="bench-tree-node"
        style={{ paddingInlineStart: (index % 6) * 12 }}
      >
        <span className="bench-tree-icon">{index % 6 === 0 ? '▸' : '·'}</span>
        <span className="bench-tree-name">{`${words(index, 2).replace(' ', '-')}.ts`}</span>
      </li>
    );
  }
  return <ul className="bench-tree">{nodes}</ul>;
}

function Chat({ extra }: { extra: number }): JSX.Element {
  const messages = [];
  for (let index = 0; index < CHAT_MESSAGES + extra; index++) {
    messages.push(
      <article key={index} className="bench-chat-message">
        <header>{index % 2 === 0 ? 'You' : 'Agent'}</header>
        <p>{words(index, 40)}</p>
        <p>{words(index + 1, 28)}</p>
        <pre>{words(index + 2, 8)}</pre>
      </article>
    );
  }
  return <div className="bench-chat">{messages}</div>;
}

export function kindOf(index: number): ContentKind {
  return KINDS[index % KINDS.length];
}

/**
 * Synthetic pane content. It counts its own renders and its ResizeObserver
 * callbacks, the two costs that a layout operation can push into content.
 */
export function PaneContent({
  id,
  index,
  weight,
}: {
  id: string;
  index: number;
  weight: ContentWeight;
}): JSX.Element {
  bump(counters.renders, id);
  const ref = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(0);

  useEffect(() => {
    appendListeners.set(id, () => setExtra((value) => value + 1));
    return () => {
      appendListeners.delete(id);
    };
  }, [id]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    let initial = true;
    // Editors and terminals refit on resize. The observer fires once on observe; skip that call.
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      bump(counters.resizeCallbacks, id);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [id]);

  const kind = kindOf(index);
  return (
    <div ref={ref} className={`bench-content bench-${weight}`} data-kind={kind}>
      {weight === 'light' ? (
        <div className="bench-card">
          <b>{id}</b>
          <span>{kind}</span>
          <span>{words(index, 4)}</span>
          {extra > 0 && <span>{`${extra} updates`}</span>}
        </div>
      ) : kind === 'terminal' ? (
        <Terminal extra={extra} />
      ) : kind === 'diff' ? (
        <Diff />
      ) : kind === 'tree' ? (
        <Tree />
      ) : (
        <Chat extra={extra} />
      )}
    </div>
  );
}
