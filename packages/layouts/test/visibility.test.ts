import { describe, expect, test } from 'bun:test';

import { PANE_VISIBILITY_EVENT } from '../src/dom/panes';
import {
  COLLAPSED,
  COLLAPSED_WHOLE,
  createPaneVisibility,
  HIDDEN,
  INACTIVE,
  OVERLAY,
  STATE_REASONS,
  ZOOM,
} from '../src/dom/visibility';
import { treeIndex } from '../src/tree-index';
import type { LayoutNode } from '../src/types';

// An element with the parts that the visibility module uses: `inert`, the
// attributes, and the visibility events that it receives.
class FakeElement extends EventTarget {
  inert = false;
  readonly attributes = new Map<string, string>();
  readonly events: boolean[] = [];
  constructor() {
    super();
    this.addEventListener(PANE_VISIBILITY_EVENT, (event) => {
      this.events.push(
        (event as CustomEvent<{ hidden: boolean }>).detail.hidden
      );
    });
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

const element = () => new FakeElement() as unknown as HTMLElement & FakeElement;

function mounted() {
  const visibility = createPaneVisibility();
  const host = element();
  const content = element();
  visibility.hostRef('a')(host);
  visibility.contentRef('a')(content);
  return { visibility, host, content };
}

describe('pane visibility', () => {
  test('the first reasons of a host write its attributes and send no event', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, HIDDEN);
    expect(host.inert).toBe(true);
    expect(host.getAttribute('data-hidden')).toBe('true');
    expect(host.events).toEqual([]);
  });

  test('a collapse makes the content inert and keeps the host', () => {
    const { visibility, host, content } = mounted();
    visibility.set('a', STATE_REASONS, 0);
    visibility.set('a', STATE_REASONS, COLLAPSED);
    expect(host.inert).toBe(false);
    expect(host.getAttribute('data-hidden')).toBeNull();
    expect(host.getAttribute('data-collapsed')).toBe('true');
    expect(content.inert).toBe(true);
    expect(content.getAttribute('data-collapsed')).toBe('true');
    expect(host.events).toEqual([true]);
    visibility.set('a', STATE_REASONS, 0);
    expect(content.inert).toBe(false);
    expect(content.getAttribute('data-collapsed')).toBeNull();
    expect(host.events).toEqual([true, false]);
  });

  test('a collapse to 0 pixels hides the whole host', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, COLLAPSED | COLLAPSED_WHOLE);
    expect(host.inert).toBe(true);
    expect(host.getAttribute('data-hidden')).toBe('true');
  });

  test('an event goes out only when the content starts or stops rendering', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, 0);
    visibility.set('a', STATE_REASONS, COLLAPSED);
    // A zoom covers the collapsed pane, ends, and the pane expands.
    visibility.set('a', ZOOM, ZOOM);
    visibility.set('a', ZOOM, 0);
    expect(host.events).toEqual([true]);
    visibility.set('a', STATE_REASONS, INACTIVE);
    expect(host.events).toEqual([true]);
    visibility.set('a', STATE_REASONS, 0);
    expect(host.events).toEqual([true, false]);
  });

  test('a covered host names what covers it: a zoom, else an overlay', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, 0);
    visibility.set('a', OVERLAY, OVERLAY);
    expect(host.getAttribute('data-covered')).toBe('overlay');
    visibility.set('a', ZOOM, ZOOM);
    expect(host.getAttribute('data-covered')).toBe('zoom');
    visibility.set('a', ZOOM, 0);
    expect(host.getAttribute('data-covered')).toBe('overlay');
    visibility.set('a', OVERLAY, 0);
    expect(host.getAttribute('data-covered')).toBeNull();
    expect(host.getAttribute('data-hidden')).toBeNull();
  });

  test('a mask keeps the reasons outside it', () => {
    const { visibility } = mounted();
    visibility.set('a', ZOOM, ZOOM);
    visibility.set('a', STATE_REASONS, COLLAPSED);
    expect(visibility.reasons('a')).toBe(ZOOM | COLLAPSED);
    visibility.set('a', STATE_REASONS, 0);
    expect(visibility.reasons('a')).toBe(ZOOM);
  });

  // React StrictMode detaches the ref of a new host and attaches it again,
  // after the effects that write the reasons.
  test('a host that mounts again keeps the reasons of its pane', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, INACTIVE);
    visibility.set('a', ZOOM | OVERLAY, ZOOM | OVERLAY);
    visibility.hostRef('a')(null);
    visibility.hostRef('a')(host);
    expect(visibility.reasons('a')).toBe(INACTIVE | ZOOM | OVERLAY);
    expect(host.inert).toBe(true);
    expect(host.getAttribute('data-hidden')).toBe('true');
    expect(host.getAttribute('data-covered')).toBe('zoom');
    const next = element();
    visibility.hostRef('a')(null);
    visibility.hostRef('a')(next);
    expect(next.inert).toBe(true);
    expect(next.getAttribute('data-hidden')).toBe('true');
  });

  test('a host that mounts again hears the next change of its rendering', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, 0);
    visibility.hostRef('a')(null);
    visibility.hostRef('a')(host);
    visibility.set('a', STATE_REASONS, HIDDEN);
    visibility.set('a', STATE_REASONS, 0);
    expect(host.events).toEqual([true, false]);
  });

  test('a pane that leaves the tree starts again with no reasons', () => {
    const { visibility, host } = mounted();
    visibility.set('a', STATE_REASONS, INACTIVE);
    visibility.hostRef('a')(null);
    visibility.forget(new Set());
    expect(visibility.reasons('a')).toBe(0);
    const next = element();
    visibility.hostRef('a')(next);
    expect(next.inert).toBe(false);
    visibility.set('a', STATE_REASONS, HIDDEN);
    expect(next.inert).toBe(true);
    expect(next.events).toEqual([]);
    expect(host.events).toEqual([]);
  });

  test('a content that mounts later gets the reasons of its pane', () => {
    const visibility = createPaneVisibility();
    visibility.hostRef('a')(element());
    visibility.set('a', STATE_REASONS, COLLAPSED);
    const content = element();
    visibility.contentRef('a')(content);
    expect(content.inert).toBe(true);
    expect(content.getAttribute('data-collapsed')).toBe('true');
  });

  test('the refs keep their identity, and listeners hear each change', () => {
    const { visibility } = mounted();
    expect(visibility.hostRef('a')).toBe(visibility.hostRef('a'));
    expect(visibility.contentRef('a')).toBe(visibility.contentRef('a'));
    let calls = 0;
    const stop = visibility.subscribe(() => {
      calls += 1;
    });
    visibility.set('a', STATE_REASONS, 0);
    visibility.set('a', STATE_REASONS, 0);
    visibility.set('a', STATE_REASONS, HIDDEN);
    stop();
    visibility.set('a', STATE_REASONS, 0);
    expect(calls).toBe(2);
  });
});

describe('tree index', () => {
  const root: LayoutNode = {
    type: 'split',
    id: 'root',
    direction: 'horizontal',
    sizes: [1, 1, 1],
    children: [
      { type: 'pane', id: 'a' },
      {
        type: 'stack',
        id: 'stack',
        active: 'b',
        children: [
          { type: 'pane', id: 'b' },
          { type: 'pane', id: 'c' },
        ],
      },
      { type: 'pane', id: 'd', hidden: true },
    ],
  };

  test('it gives each pane with its stack, and the count of panes that show', () => {
    const index = treeIndex(root);
    expect(index.panes.get('a')?.stack).toBeNull();
    expect(index.panes.get('c')?.stack?.id).toBe('stack');
    expect(index.panes.get('c')?.pane.id).toBe('c');
    expect(index.shown).toBe(2);
  });

  test('it is built once for each tree', () => {
    expect(treeIndex(root)).toBe(treeIndex(root));
  });
});
