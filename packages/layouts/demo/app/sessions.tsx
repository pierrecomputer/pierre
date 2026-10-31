import { type JSX, useId, useState, useSyncExternalStore } from 'react';

export interface Session {
  id: string;
  title: string;
  repository: string;
  branch: string;
  updated: string;
  group: 'Today' | 'Yesterday' | 'This week';
  status: 'running' | 'waiting' | 'done';
}

const SESSIONS: Session[] = [
  {
    id: 's1',
    title: 'Resize drags with heavy content',
    repository: 'pierre',
    branch: 'necolas/layout',
    updated: 'now',
    group: 'Today',
    status: 'running',
  },
  {
    id: 's2',
    title: 'Hide panes under a zoomed pane',
    repository: 'pierre',
    branch: 'necolas/fix-covered-panes',
    updated: '1h',
    group: 'Today',
    status: 'waiting',
  },
  {
    id: 's3',
    title: 'Geometry as one calc() per property',
    repository: 'pierre',
    branch: 'necolas/layout',
    updated: '3h',
    group: 'Today',
    status: 'done',
  },
  {
    id: 's4',
    title: 'Show the focus ring at once',
    repository: 'pierre',
    branch: 'necolas/fix-focus-change',
    updated: '4h',
    group: 'Today',
    status: 'done',
  },
  {
    id: 's5',
    title: 'Keep geometry out of content style',
    repository: 'pierre',
    branch: 'necolas/layout',
    updated: 'Thu',
    group: 'Yesterday',
    status: 'done',
  },
  {
    id: 's6',
    title: 'Animate layout changes with transforms',
    repository: 'pierre',
    branch: 'necolas/layout',
    updated: 'Thu',
    group: 'Yesterday',
    status: 'done',
  },
  {
    id: 's7',
    title: 'Benchmark harness and test plan',
    repository: 'pierre',
    branch: 'necolas/layout',
    updated: 'Tue',
    group: 'This week',
    status: 'done',
  },
  {
    id: 's8',
    title: 'Research prior art for layouts',
    repository: 'agent-memory',
    branch: 'main',
    updated: 'Mon',
    group: 'This week',
    status: 'done',
  },
];

const GROUPS: Session['group'][] = ['Today', 'Yesterday', 'This week'];

const STATUS_LABELS: Record<Session['status'], string> = {
  running: 'Running',
  waiting: 'Waiting for review',
  done: 'Done',
};

interface SessionState {
  sessions: readonly Session[];
  active: string;
}

let state: SessionState = { sessions: SESSIONS, active: SESSIONS[0].id };
const listeners = new Set<() => void>();
let created = 0;

/**
 * The sessions of the demo app. A store outside React lets the sidebar and the
 * agent pane title share the active session without a new `renderPane`, which
 * would render the content of every pane again.
 */
export const sessionStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): SessionState {
    return state;
  },
  select(id: string): void {
    state = { ...state, active: id };
    for (const listener of listeners) listener();
  },
  create(): void {
    created += 1;
    const session: Session = {
      id: `new-${created}`,
      title: 'New session',
      repository: 'pierre',
      branch: 'necolas/layout',
      updated: 'now',
      group: 'Today',
      status: 'waiting',
    };
    state = { sessions: [session, ...state.sessions], active: session.id };
    for (const listener of listeners) listener();
  },
};

export function useSessions(): SessionState {
  return useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getSnapshot
  );
}

/** A session list like the sidebar of an agent tool. */
export function Sessions(): JSX.Element {
  const { sessions, active } = useSessions();
  const [query, setQuery] = useState('');
  const searchId = useId();
  const shown = sessions.filter((session) =>
    session.title.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <nav className="app-sessions" aria-label="Sessions">
      <div className="app-sessions-top">
        <label htmlFor={searchId} className="app-sr">
          Search sessions
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Search sessions"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="app-new-session"
          onClick={() => sessionStore.create()}
        >
          New
        </button>
      </div>
      <div className="app-sessions-list">
        {GROUPS.map((group) => {
          const items = shown.filter((session) => session.group === group);
          if (items.length === 0) return null;
          return (
            <section key={group}>
              <h2>{group}</h2>
              <ul>
                {items.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      aria-current={session.id === active ? 'page' : undefined}
                      onClick={() => sessionStore.select(session.id)}
                    >
                      <span
                        className={`app-status app-status-${session.status}`}
                        role="img"
                        aria-label={STATUS_LABELS[session.status]}
                      />
                      <span className="app-session-title">{session.title}</span>
                      <span className="app-session-time">
                        {session.updated}
                      </span>
                      <span className="app-session-meta">
                        {session.repository} · {session.branch}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {shown.length === 0 && (
          <p className="app-sessions-empty">No sessions match.</p>
        )}
      </div>
    </nav>
  );
}
