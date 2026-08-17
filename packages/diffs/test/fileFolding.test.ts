import { afterAll, describe, expect, test } from 'bun:test';

import { File, type FileOptions } from '../src/components/File';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import { disposeHighlighter } from '../src/highlighter/shared_highlighter';
import type { FileContents } from '../src/types';
import { installDom, waitFor } from './domHarness';

afterAll(async () => {
  await disposeHighlighter();
});

const FOLDABLE_CONTENTS = [
  'function outer() {',
  '  const before = 1;',
  '  if (before) {',
  '    console.log(before);',
  '  }',
  '  return before;',
  '}',
  'const after = true;',
].join('\n');

interface ReadOnlyFileFixture {
  cleanup(): void;
  container: HTMLElement;
  file: File<undefined>;
}

async function createReadOnlyFileFixture(
  fileOptions?: Partial<FileOptions<undefined>>,
  contents = FOLDABLE_CONTENTS
): Promise<ReadOnlyFileFixture> {
  const dom = installDom();
  const container = document.createElement('div');
  document.body.appendChild(container);

  const file = new File<undefined>({
    disableFileHeader: true,
    theme: DEFAULT_THEMES,
    ...fileOptions,
  });
  const fileContents: FileContents = {
    name: 'foldable.ts',
    contents,
  };

  file.render({
    file: fileContents,
    fileContainer: container,
    forceRender: true,
  });
  await waitFor(() => renderedLineNumbers(container).length > 0, {
    timeout: 3000,
  });

  return {
    cleanup() {
      file.cleanUp();
      dom.cleanup();
    },
    container,
    file,
  };
}

function shadowRoot(container: HTMLElement): ShadowRoot {
  const shadow = container.shadowRoot;
  if (shadow == null) {
    throw new Error('file container has no shadow root');
  }
  return shadow;
}

function renderedLineNumbers(container: HTMLElement): number[] {
  return [
    ...(container.shadowRoot?.querySelectorAll<HTMLElement>(
      '[data-content] > [data-line]'
    ) ?? []),
  ].map((line) => Number(line.dataset.line));
}

function gutterRow(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLElement {
  const row = shadowRoot(container).querySelector<HTMLElement>(
    `[data-column-number="${oneIndexedLine}"]`
  );
  if (row == null) {
    throw new Error(`no gutter row found for line ${oneIndexedLine}`);
  }
  return row;
}

function foldToggle(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLButtonElement {
  const toggle = gutterRow(container, oneIndexedLine).querySelector(
    '[data-fold-toggle]'
  );
  if (!(toggle instanceof HTMLButtonElement)) {
    throw new Error(`no fold toggle found for line ${oneIndexedLine}`);
  }
  return toggle;
}

function foldIconHref(button: HTMLButtonElement): string | null {
  return button.querySelector('use')?.getAttribute('href') ?? null;
}

function foldEllipsis(
  container: HTMLElement,
  oneIndexedLine: number
): HTMLButtonElement {
  const ellipsis = shadowRoot(container).querySelector(
    `[data-content] > [data-line="${oneIndexedLine}"] > [data-fold-indicator] > [data-fold-ellipsis]`
  );
  if (!(ellipsis instanceof HTMLButtonElement)) {
    throw new Error(`no fold ellipsis found for line ${oneIndexedLine}`);
  }
  return ellipsis;
}

async function waitForLines(
  container: HTMLElement,
  expected: number[]
): Promise<void> {
  await waitFor(
    () =>
      JSON.stringify(renderedLineNumbers(container)) ===
      JSON.stringify(expected),
    { timeout: 3000 }
  );
  expect(renderedLineNumbers(container)).toEqual(expected);
}

describe('read-only File folding', () => {
  test('renders fold controls by default and folds or unfolds from the gutter', async () => {
    const { cleanup, container } = await createReadOnlyFileFixture();
    try {
      const shadow = shadowRoot(container);
      await waitFor(() => foldToggle(container, 1) != null);

      expect(shadow.querySelector('[data-code][data-folding]')).not.toBe(null);
      const initialToggle = foldToggle(container, 1);
      expect(initialToggle.getAttribute('aria-expanded')).toBe('true');
      expect(foldIconHref(initialToggle)).toBe('#diffs-icon-fold-chevron-down');
      // The context lines (return statement, closing brace) are not foldable.
      expect(gutterRow(container, 6).querySelector('[data-fold-toggle]')).toBe(
        null
      );

      initialToggle.click();
      await waitForLines(container, [1, 7, 8]);

      const foldedToggle = foldToggle(container, 1);
      expect(foldedToggle.hasAttribute('data-folded')).toBe(true);
      expect(foldedToggle.getAttribute('aria-expanded')).toBe('false');
      expect(foldIconHref(foldedToggle)).toBe('#diffs-icon-fold-chevron-right');

      const ellipsis = foldEllipsis(container, 1);
      expect(ellipsis.getAttribute('aria-label')).toBe('Unfold line 1');
      expect(foldIconHref(ellipsis)).toBe('#diffs-icon-fold-ellipsis');

      ellipsis.click();
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(shadow.querySelector('[data-fold-indicator]')).toBe(null);
      expect(foldToggle(container, 1).hasAttribute('data-folded')).toBe(false);
    } finally {
      cleanup();
    }
  });

  test('preserves a nested fold while its outer fold is toggled', async () => {
    const { cleanup, container } = await createReadOnlyFileFixture();
    try {
      await waitFor(() => foldToggle(container, 3) != null);

      foldToggle(container, 3).click();
      await waitForLines(container, [1, 2, 3, 5, 6, 7, 8]);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 2, 3, 5, 6, 7, 8]);
      expect(foldToggle(container, 3).hasAttribute('data-folded')).toBe(true);

      foldToggle(container, 3).click();
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      cleanup();
    }
  });

  test('renders no fold controls when the folding option is off', async () => {
    const { cleanup, container } = await createReadOnlyFileFixture({
      folding: false,
    });
    try {
      const shadow = shadowRoot(container);
      expect(shadow.querySelector('[data-code][data-folding]')).toBe(null);
      expect(shadow.querySelector('[data-fold]')).toBe(null);
      expect(shadow.querySelector('[data-fold-toggle]')).toBe(null);
      expect(renderedLineNumbers(container)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      cleanup();
    }
  });

  test('unfolds and removes controls when folding is disabled at runtime', async () => {
    const { cleanup, container, file } = await createReadOnlyFileFixture();
    try {
      await waitFor(() => foldToggle(container, 1) != null);
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      file.setOptions({ ...file.options, folding: false });
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      expect(shadowRoot(container).querySelector('[data-fold-toggle]')).toBe(
        null
      );

      file.setOptions({ ...file.options, folding: true });
      file.rerender();
      await waitFor(() => foldToggle(container, 1) != null);
    } finally {
      cleanup();
    }
  });

  test('resets fold state when the rendered file changes', async () => {
    const { cleanup, container, file } = await createReadOnlyFileFixture();
    try {
      await waitFor(() => foldToggle(container, 1) != null);
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      file.render({
        file: {
          name: 'foldable.ts',
          contents: `// changed\n${FOLDABLE_CONTENTS}`,
        },
        forceRender: true,
      });
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(shadowRoot(container).querySelector('[data-folded]')).toBe(null);
    } finally {
      cleanup();
    }
  });

  test('does not trigger line callbacks when a fold control is clicked', async () => {
    const lineNumberClicks: number[] = [];
    const { cleanup, container } = await createReadOnlyFileFixture({
      enableLineSelection: true,
      onLineNumberClick: (props) => {
        lineNumberClicks.push(props.lineNumber);
      },
    });
    try {
      await waitFor(() => foldToggle(container, 1) != null);

      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);
      expect(lineNumberClicks).toEqual([]);

      // Clicking the gutter cell outside the toggle still reaches the
      // line-number handler.
      gutterRow(container, 8).click();
      expect(lineNumberClicks).toEqual([8]);
    } finally {
      cleanup();
    }
  });

  test('hands folding to an attached editor and restores it on detach', async () => {
    const { cleanup, container, file } = await createReadOnlyFileFixture();
    const editor = new Editor<undefined>();
    try {
      await waitFor(() => foldToggle(container, 1) != null);
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      editor.edit(file);
      // Attaching unfolds the read-only state; the editor owns folding now.
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);

      await waitFor(() => foldToggle(container, 1) != null);
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);

      editor.cleanUp();
      // Editor teardown clears its folds; read-only controls keep working.
      await waitForLines(container, [1, 2, 3, 4, 5, 6, 7, 8]);
      await waitFor(() => foldToggle(container, 1) != null);
      foldToggle(container, 1).click();
      await waitForLines(container, [1, 7, 8]);
    } finally {
      editor.cleanUp();
      cleanup();
    }
  });
});
