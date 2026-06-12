import { describe, expect, test } from 'bun:test';

import { File } from '../src/components/File';
import { FileDiff } from '../src/components/FileDiff';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type {
  DecorationEventBaseProps,
  DiffDecorationEventBaseProps,
  DiffSpanDecoration,
  SpanDecoration,
} from '../src/types';
import { installDom, wait } from './domHarness';

const FILE_CONTENTS = 'const alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n';

async function waitForDecoration(
  fileContainer: HTMLElement
): Promise<HTMLElement> {
  for (let i = 0; i < 50; i++) {
    const el = fileContainer.shadowRoot?.querySelector(
      '[data-span-decoration]'
    );
    if (el instanceof HTMLElement) {
      return el;
    }
    await wait(10);
  }
  throw new Error('decoration span never rendered');
}

describe('Span decoration interactions', () => {
  test('onDecorationClick receives the original decoration on file views', async () => {
    const { cleanup } = installDom();
    const decorations: SpanDecoration[] = [
      { lineNumber: 2, spanStart: 6, spanLength: 4, className: 'hl' },
    ];
    const clicks: DecorationEventBaseProps[] = [];
    const instance = new File({
      disableErrorHandling: true,
      onDecorationClick: (props) => {
        clicks.push(props);
      },
    });
    try {
      const fileContainer = document.createElement('div');
      document.body.appendChild(fileContainer);
      instance.render({
        file: { name: 'example.ts', contents: FILE_CONTENTS },
        fileContainer,
        spanDecorations: decorations,
      });
      const span = await waitForDecoration(fileContainer);
      span.dispatchEvent(
        new window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
      expect(clicks.length).toBe(1);
      expect(clicks[0].type).toBe('decoration');
      expect(clicks[0].decoration).toBe(decorations[0]);
      expect(clicks[0].lineNumber).toBe(2);
      expect(clicks[0].decorationElement).toBe(span);
    } finally {
      instance.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });

  test('onDecorationEnter/Leave fire on hover transitions in diff views', async () => {
    const { cleanup } = installDom();
    const decorations: DiffSpanDecoration[] = [
      {
        side: 'additions',
        lineNumber: 2,
        spanStart: 6,
        spanLength: 1,
        className: 'hl',
      },
    ];
    const entered: DiffDecorationEventBaseProps[] = [];
    const left: DiffDecorationEventBaseProps[] = [];
    const instance = new FileDiff({
      disableErrorHandling: true,
      diffStyle: 'unified',
      onDecorationEnter: (props) => {
        entered.push(props);
      },
      onDecorationLeave: (props) => {
        left.push(props);
      },
    });
    try {
      const fileContainer = document.createElement('div');
      document.body.appendChild(fileContainer);
      instance.render({
        oldFile: {
          name: 'example.ts',
          contents: 'const a = one;\nconst b = two;\n',
        },
        newFile: {
          name: 'example.ts',
          contents: 'const a = one;\nconst b = TWO;\n',
        },
        fileContainer,
        spanDecorations: decorations,
      });
      const span = await waitForDecoration(fileContainer);
      span.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );
      expect(entered.length).toBe(1);
      expect(entered[0].decoration).toBe(decorations[0]);
      expect(entered[0].side).toBe('additions');
      expect(entered[0].lineNumber).toBe(2);
      expect(left.length).toBe(0);

      // Moving onto a different line leaves the decoration
      const otherLine = fileContainer.shadowRoot?.querySelector(
        '[data-line="1"]'
      ) as HTMLElement;
      otherLine.dispatchEvent(
        new window.PointerEvent('pointermove', {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
        })
      );
      expect(left.length).toBe(1);
      expect(left[0].decoration).toBe(decorations[0]);
    } finally {
      instance.cleanUp();
      cleanup();
      await disposeHighlighter();
    }
  });
});
