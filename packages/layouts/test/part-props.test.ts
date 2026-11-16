import { describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';

import { mergeProps, renderPart } from '../src/react/parts/part';

type Handler = (event: unknown) => void;

// An event with the part of a React event that the merge reads.
function event(): { defaultPrevented: boolean; preventDefault(): void } {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

describe('the handlers of a part', () => {
  test("the app's handler runs first, then the part's", () => {
    const calls: string[] = [];
    const merged = mergeProps(
      { onKeyDown: () => calls.push('app') },
      { onKeyDown: () => calls.push('part') }
    );
    (merged.onKeyDown as Handler)(event());
    expect(calls).toEqual(['app', 'part']);
  });

  test("the part's handler does nothing after the app calls preventDefault()", () => {
    const calls: string[] = [];
    const merged = mergeProps(
      {
        onKeyDown: (value: ReturnType<typeof event>) => {
          calls.push('app');
          value.preventDefault();
        },
      },
      { onKeyDown: () => calls.push('part') }
    );
    (merged.onKeyDown as Handler)(event());
    expect(calls).toEqual(['app']);
  });

  test('a render element, the app props, and the part all run, and the part yields last', () => {
    const calls: string[] = [];
    const props = mergeProps(
      { onClick: () => calls.push('app prop') },
      { onClick: () => calls.push('part') }
    );
    const element = renderPart(
      'button',
      createElement('div', {
        onClick: (value: ReturnType<typeof event>) => {
          calls.push('render element');
          value.preventDefault();
        },
      }),
      props,
      {}
    ) as ReactElement<{ onClick: Handler }>;
    element.props.onClick(event());
    expect(calls).toEqual(['render element', 'app prop']);
    calls.length = 0;
    const plain = renderPart('button', undefined, props, {}) as ReactElement<{
      onClick: Handler;
    }>;
    plain.props.onClick(event());
    expect(calls).toEqual(['app prop', 'part']);
  });
});
