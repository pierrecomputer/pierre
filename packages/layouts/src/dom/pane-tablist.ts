// The tab list of each pane host, for the parts that work on it, such as the
// scroll buttons: `Layout.TabList` registers its element on its host, and a
// part finds the current list of its host here and hears when it changes. A
// list that replaces another one, as when a header hides its list and shows it
// again, reaches the parts that stay mounted.

interface PaneTablist {
  list: HTMLElement | null;
  readonly listeners: Set<() => void>;
}

const hosts = new WeakMap<Element, PaneTablist>();

function entryOf(host: Element): PaneTablist {
  let entry = hosts.get(host);
  if (entry === undefined) {
    entry = { list: null, listeners: new Set() };
    hosts.set(host, entry);
  }
  return entry;
}

function setList(entry: PaneTablist, list: HTMLElement | null): void {
  if (entry.list === list) return;
  entry.list = list;
  for (const listener of [...entry.listeners]) listener();
}

/**
 * Make a tab list the list of its pane host, until the returned function
 * runs, when the list unmounts.
 */
export function registerTablist(list: HTMLElement): () => void {
  const host = list.closest('[data-layouts-pane]');
  if (host === null) return () => {};
  const entry = entryOf(host);
  setList(entry, list);
  return () => {
    if (entry.list === list) setList(entry, null);
  };
}

/** The tab list of a pane host, or null while it has none. */
export function paneTablist(host: Element): HTMLElement | null {
  return hosts.get(host)?.list ?? null;
}

/** Call a listener when a pane host gets another tab list, or loses its list. */
export function onPaneTablist(host: Element, listener: () => void): () => void {
  const { listeners } = entryOf(host);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
