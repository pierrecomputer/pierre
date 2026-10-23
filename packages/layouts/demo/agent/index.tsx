import { CodeView } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/edit';
import { FileTree } from '@pierre/trees';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import {
  type FormEvent,
  type JSX,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import './agent.css';

// The package's own source, as text, for the editor.
const SOURCES = import.meta.glob<string>(
  ['../../src/store.ts', '../../src/model.ts', '../../src/react/index.tsx'],
  { query: '?raw', import: 'default', eager: true }
);

// A repository like the one that an agent works in.
const PATHS = [
  'AGENTS.md',
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'moon.yml',
  'packages/layouts/README.md',
  'packages/layouts/package.json',
  'packages/layouts/moon.yml',
  'packages/layouts/src/index.ts',
  'packages/layouts/src/types.ts',
  'packages/layouts/src/model.ts',
  'packages/layouts/src/store.ts',
  'packages/layouts/src/geometry.ts',
  'packages/layouts/src/css-layout.ts',
  'packages/layouts/src/styles.css',
  'packages/layouts/src/react/index.tsx',
  'packages/layouts/test/model.test.ts',
  'packages/layouts/test/test-plan.md',
  'packages/layouts/test/e2e/layout.pw.ts',
  'packages/layouts/test/e2e/requirements.pw.ts',
  'packages/layouts/bench/README.md',
  'packages/layouts/bench/layout.bench.ts',
  'packages/layouts/bench/lib/trace.ts',
  'packages/layouts/bench/lib/measure.ts',
  'packages/layouts/bench/lib/checks.ts',
  'packages/layouts/bench/lib/scenarios.ts',
  'packages/layouts/bench/lib/bundle.ts',
  'packages/layouts/demo/main.tsx',
  'packages/layouts/demo/agent/index.tsx',
  'packages/diffs/README.md',
  'packages/diffs/src/index.ts',
  'packages/diffs/src/components/CodeView.ts',
  'packages/diffs/src/components/FileDiff.ts',
  'packages/diffs/src/editor/editor.ts',
  'packages/diffs/src/editor/textDocument.ts',
  'packages/diffs/src/react/index.ts',
  'packages/trees/README.md',
  'packages/trees/src/index.ts',
  'packages/highlights/src/index.ts',
  'apps/docs/package.json',
  'apps/docs/app/layout.tsx',
  'apps/docs/app/page.tsx',
  'apps/diffshub/package.json',
  'apps/diffshub/components/ThemedFileDiff.tsx',
];

/** The repository's files, from `@pierre/trees`. */
function Files(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const tree = new FileTree({ paths: PATHS, initialExpansion: 'open' });
    tree.render({ containerWrapper: element });
    return () => tree.cleanUp();
  }, []);
  return <div ref={ref} className="agent-files" />;
}

interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
  tools?: string[];
  code?: string;
}

const HISTORY: Message[] = [
  {
    id: 1,
    role: 'user',
    text: 'The zoom animation stutters when the terminal prints a lot of output. Can you find out why?',
  },
  {
    id: 2,
    role: 'agent',
    text: 'The view animates left, top, width, and height with CSS transitions. These run on the main thread, so the zoomed pane lays out its content on every frame, and a busy terminal drops frames.',
    tools: [
      'Read packages/layouts/src/react/index.tsx',
      'Read packages/layouts/src/styles.css',
      'Ran moon run layouts:bench -- zoom',
    ],
    code: 'zoom · 4 panes · real\n  layouts 53 · refits 26 · animations on the main thread 7',
  },
  {
    id: 3,
    role: 'user',
    text: 'Animate with transforms instead, and measure it again.',
  },
  {
    id: 4,
    role: 'agent',
    text: 'Done. Each element now animates from its old box with a transform, so the compositor runs it and the content lays out once.',
    tools: [
      'Edited packages/layouts/src/react/index.tsx',
      'Ran moon run layouts:test-e2e',
      'Ran moon run layouts:bench',
    ],
    code: 'zoom · 4 panes · real\n  layouts 53 → 3 · refits 26 → 1 · main-thread animations 7 → 0',
  },
];

const REPLY =
  'I read the layout store and the view. The focus ring still moves on every click into a pane, and every pane renders its content again when the focus changes. I can memoize the pane hosts next, so that a focus change renders no content, and measure the change with the focus scenario of the bench.';

/** An agent chat with a composer. A sent message gets a streamed reply. */
function Chat(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>(HISTORY);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    const element = log.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [messages]);

  function send(event: FormEvent): void {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || streaming) return;
    setDraft('');
    setStreaming(true);
    const replyId = Date.now() + 1;
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: 'user', text },
      { id: replyId, role: 'agent', text: '' },
    ]);
    // Stream the reply word by word, as an agent's tokens arrive.
    const words = REPLY.split(' ');
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setMessages((current) =>
        current.map((message) =>
          message.id === replyId
            ? { ...message, text: words.slice(0, index).join(' ') }
            : message
        )
      );
      if (index >= words.length) {
        clearInterval(timer);
        setStreaming(false);
      }
    }, 45);
  }

  return (
    <div className="agent-chat">
      <div
        ref={log}
        className="agent-chat-log"
        role="log"
        aria-label="Conversation"
      >
        {messages.map((message) => (
          <article
            key={message.id}
            className={`agent-message agent-message-${message.role}`}
          >
            <header>{message.role === 'user' ? 'You' : 'Agent'}</header>
            <p>{message.text}</p>
            {message.tools?.map((tool) => (
              <div key={tool} className="agent-tool">
                {tool}
              </div>
            ))}
            {message.code !== undefined && <pre>{message.code}</pre>}
          </article>
        ))}
      </div>
      <form className="agent-composer" onSubmit={send}>
        <label htmlFor={inputId} className="agent-sr">
          Message the agent
        </label>
        <textarea
          id={inputId}
          value={draft}
          rows={2}
          placeholder="Ask the agent to change the layout…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) send(event);
          }}
        />
        <button type="submit" disabled={streaming}>
          {streaming ? 'Working…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

/** Editable source files in a `@pierre/diffs` CodeView. */
function SourceEditor(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const viewer = new CodeView({
      theme: { light: 'pierre-light', dark: 'pierre-dark' },
      stickyHeaders: true,
      getEditStateKey: (item) => `draft:${item.id}`,
      createEditor: (editorType, options, editStateKey) =>
        new Editor(editorType, options, editStateKey),
      // Keep each edit in the view; the demo has no files to save.
      onItemEditComplete: () => 'accept',
    });
    viewer.setup(element);
    viewer.setItems(
      Object.entries(SOURCES).map(([path, contents]) => ({
        id: `file:${path}`,
        type: 'file' as const,
        file: {
          name: path.replace('../../', 'packages/layouts/'),
          contents,
        },
        edit: true,
        version: 0,
      }))
    );
    return () => viewer.cleanUp();
  }, []);
  return <div ref={ref} className="agent-editor" />;
}

const SESSION = [
  '\u001b[32m$\u001b[0m moon run layouts:test',
  '\u001b[90m▮▮▮▮ layouts:test\u001b[0m',
  ' 13 pass',
  ' 0 fail',
  '\u001b[32m$\u001b[0m moon run layouts:test-e2e',
  '  ✓ container resizing resolves synchronously in CSS while zoom animates with transforms',
  '  ✓ zoom and rearrangement retain pane DOM, notes, counters, and scroll',
  '  ✓ pointer resizing, keyboard limits, and Escape cancellation',
  '  12 passed (9.3s)',
  '\u001b[32m$\u001b[0m moon run layouts:bench-compare -- before.json after.json',
  'Checks that changed state:',
  '  zoom-busy-no-dropped-frames: FAIL 23 -> pass 0',
  '  zoom-animations-composited: FAIL 7 -> pass 0',
  '  checks that pass: 5 -> 9 of 30',
];

/** A terminal emulator with a scripted session. Typed input echoes. */
function Shell(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const terminal = new Terminal({
      fontSize: 12,
      cursorBlink: true,
      theme: { background: '#11161d' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    terminal.write(`${SESSION.join('\r\n')}\r\n\u001b[32m$\u001b[0m `);
    fit.fit();
    let line = '';
    const input = terminal.onData((data) => {
      if (data === '\r') {
        terminal.write(
          line.length > 0
            ? `\r\n${line}: not available in the demo\r\n\u001b[32m$\u001b[0m `
            : '\r\n\u001b[32m$\u001b[0m '
        );
        line = '';
      } else if (data === '\u007f') {
        if (line.length > 0) {
          line = line.slice(0, -1);
          terminal.write('\b \b');
        }
      } else if (data >= ' ') {
        line += data;
        terminal.write(data);
      }
    });
    // The terminal refits its rows and columns when its pane changes size.
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    return () => {
      observer.disconnect();
      input.dispose();
      terminal.dispose();
    };
  }, []);
  return <div ref={ref} className="agent-terminal" />;
}

/** The content of one pane of the agent view. */
export default function AgentPane({ id }: { id: string }): JSX.Element {
  if (id === 'files') return <Files />;
  if (id === 'agent') return <Chat />;
  if (id === 'editor') return <SourceEditor />;
  return <Shell />;
}
