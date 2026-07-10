import { describe, expect, test } from 'bun:test';

import {
  type MatchRange,
  type SearchPanelOptions,
  SearchPanelWidget,
} from '../src/editor/searchPanel';
import type { ResolvedTextEdit } from '../src/editor/textDocument';
import { TextDocument } from '../src/editor/textDocument';
import { installDom, wait } from './domHarness';

function setInputValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(
    new window.Event('input', { bubbles: true, cancelable: true })
  );
}

function pressKey(
  input: HTMLInputElement,
  key: string,
  init: KeyboardEventInit = {}
): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  input.dispatchEvent(event);
  return event;
}

interface WidgetHarness {
  widget: SearchPanelWidget;
  input: HTMLInputElement;
  replaceInput: HTMLInputElement;
  button(container: string, index: number): HTMLButtonElement;
  matchesText(): string | null;
  mode(): string | undefined;
  scrolled: MatchRange[];
  applied: ResolvedTextEdit[][];
  updates: (MatchRange[] | undefined)[];
  isClosed(): boolean;
  cleanup(): void;
}

// Mounts a SearchPanelWidget over an in-memory document and records everything
// the widget hands back to its host (scroll targets, replace edits, match-set
// updates, and close). The default onUpdate selects the first match as current,
// like the editor selecting the first hit on open; pass `selectCurrent: false`
// to model a host with no match under the caret (the "N results" state).
function createWidget(
  contents: string,
  options: {
    defaultQuery?: string;
    mode?: SearchPanelOptions['mode'];
    selectCurrent?: boolean;
  } = {}
): WidgetHarness {
  const { defaultQuery = '', mode, selectCurrent = true } = options;
  const dom = installDom();
  const textDocument = new TextDocument<undefined>(
    'inmemory://search-panel',
    contents
  );
  const containerElement = document.createElement('div');
  document.body.appendChild(containerElement);

  const scrolled: MatchRange[] = [];
  const applied: ResolvedTextEdit[][] = [];
  const updates: (MatchRange[] | undefined)[] = [];

  let closed = false;
  const widget = new SearchPanelWidget({
    textDocument,
    containerElement,
    defaultQuery,
    mode,
    scrollToMatch: (nextMatch) => scrolled.push([...nextMatch]),
    applyReplace: (edits) => applied.push(edits),
    onUpdate: (matches) => {
      updates.push(matches.map((match) => [...match] as MatchRange));
      return selectCurrent ? matches[0] : undefined;
    },
    onClose: () => {
      closed = true;
    },
  });

  const query = (selector: string) =>
    document.querySelector<HTMLElement>(`[data-search-panel] ${selector}`);

  return {
    widget,
    input: query('input[data-search]') as HTMLInputElement,
    replaceInput: query('input[data-replace]') as HTMLInputElement,
    button: (container, index) =>
      document.querySelectorAll<HTMLButtonElement>(
        `[data-search-panel] [data-${container}] button`
      )[index],
    matchesText: () => query('[data-matches]')?.textContent ?? null,
    mode: () => query('[data-search-grid]')?.dataset.mode,
    scrolled,
    applied,
    updates,
    isClosed: () => closed,
    cleanup: () => {
      widget.cleanup();
      containerElement.remove();
      dom.cleanup();
    },
  };
}

describe('SearchPanelWidget', () => {
  test('Shift+Enter in the find input navigates to the previous match', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');

      const forward = pressKey(harness.input, 'Enter');
      expect(forward.defaultPrevented).toBe(true);
      expect(harness.scrolled.at(-1)).toEqual([4, 7]);

      const backward = pressKey(harness.input, 'Enter', { shiftKey: true });
      expect(backward.defaultPrevented).toBe(true);
      expect(harness.scrolled.at(-1)).toEqual([0, 3]);
    } finally {
      harness.cleanup();
    }
  });

  test('shows the running match position and total', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      // onUpdate selects the first match, so the panel reads "1 of 3".
      expect(harness.matchesText()).toBe('1 of 3');
      pressKey(harness.input, 'Enter');
      expect(harness.matchesText()).toBe('2 of 3');
    } finally {
      harness.cleanup();
    }
  });

  test('shows a bare result count when no match is current', async () => {
    const harness = createWidget('foo foo', { selectCurrent: false });
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      expect(harness.matchesText()).toBe('2 results');
    } finally {
      harness.cleanup();
    }
  });

  test('clears the matches and disables navigation for an empty query', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      setInputValue(harness.input, '');

      expect(harness.matchesText()).toBe('No results');
      // An empty query pushes an empty match set so the editor drops its
      // highlights, and the prev/next arrows go disabled.
      expect(harness.updates.at(-1)).toEqual([]);
      expect(harness.button('search-nav', 0).disabled).toBe(true);
      expect(harness.button('search-nav', 1).disabled).toBe(true);
    } finally {
      harness.cleanup();
    }
  });

  test('wraps past the last match to the first and before the first to the last', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo'); // current = [0, 3]
      pressKey(harness.input, 'Enter'); // -> [4, 7]
      pressKey(harness.input, 'Enter'); // -> [8, 11]
      pressKey(harness.input, 'Enter'); // wraps -> [0, 3]
      expect(harness.scrolled.at(-1)).toEqual([0, 3]);

      pressKey(harness.input, 'Enter', { shiftKey: true }); // wraps -> [8, 11]
      expect(harness.scrolled.at(-1)).toEqual([8, 11]);
    } finally {
      harness.cleanup();
    }
  });

  test('replace edits the current match and collapses past it', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo'); // current = [0, 3]
      setInputValue(harness.replaceInput, 'bar');
      pressKey(harness.replaceInput, 'Enter');

      expect(harness.applied).toEqual([[{ start: 0, end: 3, text: 'bar' }]]);
      // The panel scrolls to a collapsed caret at the end of the replacement.
      expect(harness.scrolled.at(-1)).toEqual([3, 3]);
    } finally {
      harness.cleanup();
    }
  });

  test('replace all edits every match at once', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo');
      setInputValue(harness.replaceInput, 'bar');
      harness.button('replace-actions', 1).click();

      expect(harness.applied.at(-1)).toEqual([
        { start: 0, end: 3, text: 'bar' },
        { start: 4, end: 7, text: 'bar' },
        { start: 8, end: 11, text: 'bar' },
      ]);
    } finally {
      harness.cleanup();
    }
  });

  test('replace does nothing when there are no matches', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'zzz'); // no matches
      setInputValue(harness.replaceInput, 'bar');
      harness.button('replace-actions', 0).click();
      expect(harness.applied).toEqual([]);
    } finally {
      harness.cleanup();
    }
  });

  test('cmd+f and cmd+opt+f toggle the panel between find and replace modes', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      expect(harness.mode()).toBe('find');

      pressKey(harness.input, 'f', { metaKey: true, altKey: true });
      expect(harness.mode()).toBe('replace');

      pressKey(harness.input, 'f', { metaKey: true });
      expect(harness.mode()).toBe('find');

      // setMode drives the same transition programmatically.
      harness.widget.setMode('replace');
      expect(harness.mode()).toBe('replace');
    } finally {
      harness.cleanup();
    }
  });

  test('toggling case sensitivity re-runs the search', async () => {
    const harness = createWidget('Foo foo');
    try {
      await wait(0);
      setInputValue(harness.input, 'foo'); // case-insensitive: two matches
      expect(harness.matchesText()).toBe('1 of 2');

      const caseToggle = harness.button('search-toggles', 0);
      expect(caseToggle.ariaPressed).toBe('false');
      caseToggle.click();

      // Case sensitivity now excludes "Foo", leaving a single match.
      expect(caseToggle.ariaPressed).toBe('true');
      expect(harness.matchesText()).toBe('1 of 1');
    } finally {
      harness.cleanup();
    }
  });

  test('Escape closes the panel and notifies the host', async () => {
    const harness = createWidget('foo foo foo');
    try {
      await wait(0);
      const escape = pressKey(harness.input, 'Escape');
      expect(escape.defaultPrevented).toBe(true);
      expect(harness.isClosed()).toBe(true);
      expect(document.querySelector('[data-search-panel]')).toBeNull();
    } finally {
      harness.cleanup();
    }
  });
});
