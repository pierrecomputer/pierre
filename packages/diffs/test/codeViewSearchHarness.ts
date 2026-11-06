import type { CodeView } from '../src/components/CodeView';
import { getSearchHighlightRanges } from './domHarness';

export interface SearchMatchProbe {
  itemId: string;
  itemType: 'file' | 'diff';
  side: 'deletions' | 'additions' | undefined;
  lineNumber: number;
  lineIndex: number;
  startCharacter: number;
  endCharacter: number;
}

export interface SearchStateProbe {
  searchState: {
    scope: { itemId: string } | undefined;
    matches: SearchMatchProbe[];
    current: SearchMatchProbe | undefined;
  };
}

export function dispatchPrimaryFind(
  root: HTMLElement,
  altKey = false
): KeyboardEvent {
  const attempts = [
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ];
  let lastEvent: KeyboardEvent | undefined;
  for (const modifiers of attempts) {
    const event = new window.KeyboardEvent('keydown', {
      key: 'f',
      code: 'KeyF',
      altKey,
      composed: true,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    root.dispatchEvent(event);
    lastEvent = event;
    if (event.defaultPrevented) {
      return event;
    }
  }
  return lastEvent!;
}

export function dispatchFindAgain(
  target: EventTarget,
  options: { previous?: boolean; composed?: boolean } = {}
): KeyboardEvent {
  const attempts = [
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
  ];
  let lastEvent: KeyboardEvent | undefined;
  for (const modifiers of attempts) {
    const event = new window.KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      shiftKey: options.previous === true,
      bubbles: true,
      cancelable: true,
      composed: options.composed === true,
      ...modifiers,
    });
    target.dispatchEvent(event);
    lastEvent = event;
    if (event.defaultPrevented) {
      return event;
    }
  }
  return lastEvent!;
}

export function dispatchEscape(root: HTMLElement): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  root.dispatchEvent(event);
  return event;
}

export function fillSearch(root: HTMLElement, value: string): void {
  const input = getSearchInput(root);
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

export function fillReplace(
  root: HTMLElement,
  value: string
): HTMLInputElement {
  const input = getSearchPanelRoot(root).querySelector<HTMLInputElement>(
    'input[data-replace]'
  );
  if (input == null) {
    throw new Error('Expected replacement input');
  }
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  return input;
}

export function replaceFromPanel(root: HTMLElement, all = false): void {
  getSearchPanelRoot(root)
    .querySelector<HTMLButtonElement>(
      `button[title="${all ? 'Replace All' : 'Replace'}"]`
    )!
    .click();
}

export function getSearchPanelHost(root: HTMLElement): HTMLElement {
  const host = root.querySelector<HTMLElement>('[data-search-panel]');
  if (host === null) {
    throw new Error('Expected CodeView search panel');
  }
  return host;
}

export function getSearchPanelRoot(root: HTMLElement): ShadowRoot {
  const shadowRoot = getSearchPanelHost(root).shadowRoot;
  if (shadowRoot === null) {
    throw new Error('Expected CodeView search panel shadow root');
  }
  return shadowRoot;
}

export function getSearchInput(root: HTMLElement): HTMLInputElement {
  const input =
    getSearchPanelRoot(root).querySelector<HTMLInputElement>(
      'input[data-search]'
    );
  if (input === null) {
    throw new Error('Expected CodeView search input');
  }
  return input;
}

export function pressSearchEnter(root: HTMLElement): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
  });
  getSearchInput(root).dispatchEvent(event);
  return event;
}

export function makeSearchScrollContents(): string {
  return Array.from({ length: 600 }, (_, index) => {
    if (index === 0) {
      return 'target first';
    }
    if (index === 499) {
      return 'target second';
    }
    return `line ${index + 1}`;
  }).join('\n');
}

// jsdom needs a tab stop to focus contentEditable; focus still reaches the
// real editor's listeners, just as it does in the browser.
export function getEditorContent(viewer: CodeView, id: string): HTMLElement {
  const content = viewer
    .getRenderedItems()
    .find((item) => item.id === id)
    ?.element.shadowRoot?.querySelector<HTMLElement>(
      '[data-code]:not([data-deletions]) > [data-content]'
    );
  if (content == null) {
    throw new Error(`Expected editor content for ${id}`);
  }
  content.tabIndex = 0;
  return content;
}

export function getSearchState(
  viewer: CodeView
): SearchStateProbe['searchState'] {
  return (viewer as unknown as SearchStateProbe).searchState;
}

export function getRenderedSearchMatches(root: HTMLElement): Range[] {
  return getSearchHighlightRanges(root);
}

export function getRenderedCurrentSearchMatches(root: HTMLElement): Range[] {
  return getSearchHighlightRanges(root, true);
}

export function getSearchMatchSide(range: Range): string | undefined {
  const element = range.startContainer.parentElement!;
  if (element.closest('[data-deletions]') != null) return 'deletions';
  if (element.closest('[data-additions]') != null) return 'additions';
  if (element.closest('[data-unified]') != null) return 'unified';
  return undefined;
}
