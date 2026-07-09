import { describe, expect, test } from 'bun:test';

import { type MatchRange, SearchPanelWidget } from '../src/editor/searchPanel';
import { TextDocument } from '../src/editor/textDocument';
import { installDom, wait } from './domHarness';

function setSearchQuery(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(
    new window.Event('input', {
      bubbles: true,
      cancelable: true,
    })
  );
}

function pressEnter(input: HTMLInputElement, shiftKey = false): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    key: 'Enter',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  return event;
}

describe('SearchPanelWidget', () => {
  test('uses Shift+Enter in the find input to navigate to the previous match', async () => {
    const { cleanup } = installDom();
    const textDocument = new TextDocument<undefined>(
      'inmemory://search-panel',
      'foo foo foo'
    );
    const containerElement = document.createElement('div');
    document.body.appendChild(containerElement);
    const scrolledMatches: MatchRange[] = [];

    const widget = new SearchPanelWidget({
      textDocument,
      containerElement,
      defaultQuery: '',
      scrollToMatch: (nextMatch) => {
        scrolledMatches.push([...nextMatch]);
      },
      applyReplace: () => {},
      onUpdate: (matches) => matches[0],
      onClose: () => {},
    });

    try {
      await wait(0);

      const input = document.querySelector<HTMLInputElement>(
        '[data-search-panel] input[data-search]'
      );
      expect(input).not.toBeNull();

      setSearchQuery(input!, 'foo');
      const forward = pressEnter(input!);
      expect(forward.defaultPrevented).toBe(true);
      expect(scrolledMatches.at(-1)).toEqual([4, 7]);

      const backward = pressEnter(input!, true);
      expect(backward.defaultPrevented).toBe(true);
      expect(scrolledMatches.at(-1)).toEqual([0, 3]);
    } finally {
      widget.cleanup();
      cleanup();
    }
  });
});
