// The role and the name of a pane host come from the parts in it: a tab
// list makes the host the tab panel of its tab, else a title heading names
// it, else the host keeps the `aria-label` that `Root` renders. This module
// alone writes `role` and `aria-labelledby` on a host, from the parts that
// render in it, so the order in which they mount and unmount does not
// matter. Only `Layout.Title` and `Layout.TabList` import it, so an app with
// neither does not load it.

/** A part that names a host: a title heading, or the tab of the pane. */
export type HostNamePart = 'title' | 'tab';

interface Label {
  readonly part: HostNamePart;
  readonly labelId: string;
}

// The parts that render in each host, in the order that they came. A host
// that unmounts takes its entry with it.
const labels = new WeakMap<Element, readonly Label[]>();

function write(host: Element, parts: readonly Label[]): void {
  labels.set(host, parts);
  const label = parts.find(({ part }) => part === 'tab') ?? parts[0];
  if (label?.part === 'tab') host.setAttribute('role', 'tabpanel');
  else host.removeAttribute('role');
  if (label === undefined) host.removeAttribute('aria-labelledby');
  else host.setAttribute('aria-labelledby', label.labelId);
}

/**
 * A part of the chrome of a pane says that it renders in the host of the
 * pane, with the ID of its element that names the host. It returns a
 * function that says that the part is gone, or nothing outside a host.
 */
export function nameHost(
  element: Element,
  part: HostNamePart,
  labelId: string
): (() => void) | undefined {
  const host = element.closest('[data-layouts-pane]');
  if (host === null) return undefined;
  const label: Label = { part, labelId };
  write(host, [...(labels.get(host) ?? []), label]);
  return () =>
    write(
      host,
      (labels.get(host) ?? []).filter((each) => each !== label)
    );
}
