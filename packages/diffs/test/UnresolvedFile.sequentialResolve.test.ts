import { describe, expect, test } from 'bun:test';

import { disposeHighlighter } from '../src';
import { UnresolvedFile } from '../src/components/UnresolvedFile';
import { DEFAULT_THEMES } from '../src/constants';
import type {
  FileContents,
  MergeConflictActionPayload,
  MergeConflictResolution,
} from '../src/types';
import {
  parseMergeConflictDiffFromFile,
  type ParseMergeConflictDiffFromFileResult,
} from '../src/utils/parseMergeConflictDiffFromFile';
import { installDom, wait } from './domHarness';

// Two independent conflicts, mirroring the docs "Merge conflict resolution UI"
// example, which lets us resolve one and then attempt to resolve the other.
const TWO_CONFLICT_FILE: FileContents = {
  name: 'session.ts',
  contents: [
    'const start = true;',
    '<<<<<<< HEAD',
    'const ttl = 12;',
    '=======',
    'const ttl = 24;',
    '>>>>>>> feature',
    'const middle = true;',
    '<<<<<<< HEAD',
    'const max = 1;',
    '=======',
    'const max = 2;',
    '>>>>>>> feature',
    'const end = true;',
    '',
  ].join('\n'),
};

type ConflictState = Pick<
  ParseMergeConflictDiffFromFileResult,
  'fileDiff' | 'actions' | 'markerRows'
>;

// Reproduces what packages/diffs/src/react/utils/useUnresolvedFileInstance.ts
// does in the browser: the component is "controlled" (it passes
// onMergeConflictAction), keeps {fileDiff, actions, markerRows} as its own
// state, and after every state change re-renders the instance from that state.
function mountControlledUnresolvedFile(file: FileContents) {
  const fileContainer = document.createElement('div');
  document.body.appendChild(fileContainer);

  let state: ConflictState = parseMergeConflictDiffFromFile(file);

  const onMergeConflictAction = (
    payload: MergeConflictActionPayload,
    inst: UnresolvedFile
  ): void => {
    const result = inst.resolveConflict(
      payload.conflict.conflictIndex,
      payload.resolution,
      state.fileDiff
    );
    if (result == null) {
      return;
    }
    state = {
      fileDiff: result.fileDiff,
      actions: result.actions,
      markerRows: result.markerRows,
    };
    // Mirrors the hook's useIsomorphicLayoutEffect: push current state into
    // the instance after every state change.
    inst.render({
      fileDiff: state.fileDiff,
      actions: state.actions,
      markerRows: state.markerRows,
    });
  };

  const instance = new UnresolvedFile(
    {
      theme: DEFAULT_THEMES,
      mergeConflictActionsType: 'default',
      onMergeConflictAction,
    },
    undefined,
    true
  );

  instance.hydrate({
    fileDiff: state.fileDiff,
    actions: state.actions,
    markerRows: state.markerRows,
    fileContainer,
  });

  return { instance, fileContainer, getState: () => state };
}

function actionButton(
  fileContainer: HTMLElement,
  conflictIndex: number,
  resolution: MergeConflictResolution
): HTMLButtonElement | null {
  const root = fileContainer.shadowRoot ?? fileContainer;
  return root.querySelector<HTMLButtonElement>(
    `button[data-merge-conflict-action="${resolution}"][data-merge-conflict-conflict-index="${conflictIndex}"]`
  );
}

// The diff renders asynchronously while the highlighter loads, so poll until
// the requested conflict's action button is in the DOM.
async function waitForActionButton(
  fileContainer: HTMLElement,
  conflictIndex: number,
  resolution: MergeConflictResolution
): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const button = actionButton(fileContainer, conflictIndex, resolution);
    if (button != null) {
      return button;
    }
    await wait(10);
  }
  throw new Error(
    `Timed out waiting for conflict ${conflictIndex} ${resolution} button`
  );
}

function clickActionButton(button: HTMLButtonElement): void {
  button.dispatchEvent(
    new window.MouseEvent('click', { bubbles: true, composed: true })
  );
}

describe('UnresolvedFile sequential conflict resolution', () => {
  test('a second conflict can still be resolved after the first', async () => {
    const { cleanup } = installDom();
    const { fileContainer, getState } =
      mountControlledUnresolvedFile(TWO_CONFLICT_FILE);
    try {
      // Both conflicts start unresolved with clickable action buttons.
      expect(getState().actions[0]).not.toBeUndefined();
      expect(getState().actions[1]).not.toBeUndefined();
      const firstButton = await waitForActionButton(
        fileContainer,
        0,
        'current'
      );

      // Resolve the first conflict — this updates the rendered diff.
      clickActionButton(firstButton);
      await wait(0);

      expect(getState().actions[0]).toBeUndefined();
      expect(getState().actions[1]).not.toBeUndefined();

      // The second conflict's buttons should still be present and functional.
      const secondButton = await waitForActionButton(
        fileContainer,
        1,
        'incoming'
      );

      clickActionButton(secondButton);
      await wait(0);

      // BUG: clicking the second conflict's action does nothing.
      expect(getState().actions[1]).toBeUndefined();
    } finally {
      document.body.innerHTML = '';
      await wait(0);
      cleanup();
      await disposeHighlighter();
    }
  });
});
