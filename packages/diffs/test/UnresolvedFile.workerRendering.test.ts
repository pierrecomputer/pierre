import { afterAll, beforeAll, expect, test } from 'bun:test';

import { UnresolvedFile } from '../src/components/UnresolvedFile';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  DiffLineAnnotation,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  MergeConflictActionPayload,
  PostRenderPhase,
} from '../src/types';
import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { renderDiffWithHighlighter } from '../src/utils/renderDiffWithHighlighter';
import type { RenderDiffRequest } from '../src/worker/types';
import { installDom, wait, waitFor } from './domHarness';
import { createInitializedManager, withTimeout } from './workerPoolHarness';

let highlighter: DiffsHighlighter;
beforeAll(async () => {
  highlighter = await getSharedHighlighter({
    themes: ['pierre-dark'],
    langs: ['typescript'],
    preferredHighlighter: 'shiki-js',
  });
});
afterAll(async () => {
  await disposeHighlighter();
});

class TestUnresolvedFile extends UnresolvedFile<string> {
  getRenderedDiffForTest(): FileDiffMetadata | undefined {
    return this.getRenderedDiff();
  }
}

const file: FileContents = {
  name: 'conflicts.ts',
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

// Keep highlighting pending while exercising both retained DOM and the next
// conflict state, then release the worker result to verify their adoption.
async function createFixture(custom: boolean, controlled: boolean) {
  const dom = installDom();
  const { manager, worker } = await createInitializedManager({
    theme: 'pierre-dark',
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const payloads: MergeConflictActionPayload[] = [];
  const renderPhases: PostRenderPhase[] = [];
  const instance = new TestUnresolvedFile(
    {
      disableErrorHandling: true,
      disableFileHeader: true,
      theme: 'pierre-dark',
      onPostRender: (_node, _instance, phase) => {
        renderPhases.push(phase);
      },
      mergeConflictActionsType: custom
        ? (action) => {
            const button = document.createElement('button');
            button.dataset.mergeConflictAction = 'current';
            button.dataset.mergeConflictConflictIndex = String(
              action.conflictIndex
            );
            button.textContent = `custom:${action.conflictIndex}`;
            return button;
          }
        : 'default',
      onMergeConflictAction: controlled
        ? (payload) => {
            payloads.push(payload);
          }
        : undefined,
      onMergeConflictResolve: controlled
        ? undefined
        : (_file, payload) => {
            payloads.push(payload);
          },
      renderAnnotation(annotation) {
        const element = document.createElement('span');
        element.textContent = annotation.metadata;
        return element;
      },
    },
    manager
  );
  const initial = parseMergeConflictDiffFromFile(file);
  const annotations: DiffLineAnnotation<string>[] = [
    { side: 'additions', lineNumber: 1, metadata: 'annotation:A' },
  ];
  const getRequest = async (count: number) => {
    await waitFor(() => worker.diffRequestCount >= count);
    return withTimeout(worker.waitForDiffRequest());
  };
  const respond = (request: RenderDiffRequest, diff: FileDiffMetadata) => {
    const options = manager.getDiffRenderOptions();
    worker.respond({
      type: 'success',
      requestType: 'diff',
      id: request.id,
      result: renderDiffWithHighlighter(diff, highlighter, options),
      options,
      sentAt: Date.now(),
    });
  };
  const button = (index: number) =>
    (custom
      ? container
      : container.shadowRoot
    )?.querySelector<HTMLButtonElement>(
      `button[data-merge-conflict-action="current"][data-merge-conflict-conflict-index="${index}"]`
    );
  const click = (index: number) => {
    const target = button(index);
    if (target == null) throw new Error(`Missing conflict ${index} button`);
    target.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, composed: true })
    );
  };
  const annotationText = () =>
    container.querySelector('[slot="annotation-additions-1"]')?.textContent;
  const markerCount = () =>
    container.shadowRoot?.querySelectorAll('[data-merge-conflict-marker-row]')
      .length ?? 0;
  instance.render({
    fileContainer: container,
    lineAnnotations: annotations,
    ...(controlled ? { file, ...initial } : { file }),
  });
  const request = await getRequest(1);
  respond(request, request.diff);
  await waitFor(() => button(0) != null && annotationText() === 'annotation:A');
  renderPhases.length = 0;
  return {
    instance,
    initial,
    payloads,
    renderPhases,
    button,
    click,
    annotationText,
    markerCount,
    getRequest,
    respond,
    cleanup() {
      instance.cleanUp();
      manager.terminate();
      dom.cleanup();
    },
  };
}

for (const custom of [false, true]) {
  test(`UnresolvedFile adopts annotations, markers and ${custom ? 'custom' : 'default'} actions with the highlighted diff`, async () => {
    const fixture = await createFixture(custom, true);
    const { instance, initial, payloads, annotationText, markerCount, button } =
      fixture;
    try {
      const initialMarkers = markerCount();
      expect(initialMarkers).toBeGreaterThan(0);
      const replacement = instance.resolveConflict(0, 'current');
      if (replacement == null)
        throw new Error('Expected a resolved first conflict');
      instance.render({ ...replacement, lineAnnotations: [] });
      expect(instance.fileDiff).toBe(replacement.fileDiff);
      expect(instance.getRenderedDiffForTest()).toBe(initial.fileDiff);
      expect(annotationText()).toBe('annotation:A');
      expect(markerCount()).toBe(initialMarkers);
      expect(button(0)).not.toBeNull();
      expect(button(1)).not.toBeNull();
      // This conflict is still unresolved in both states: unlike clicking the
      // already-resolved first action, this actually exercises the click guard.
      fixture.click(1);
      expect(payloads).toHaveLength(0);
      fixture.respond(await fixture.getRequest(2), replacement.fileDiff);
      await waitFor(
        () => instance.getRenderedDiffForTest() === replacement.fileDiff
      );
      expect(annotationText()).toBeUndefined();
      expect(markerCount()).toBe(initialMarkers / 2);
      expect(button(0)).toBeNull();
      fixture.click(1);
      expect(payloads).toHaveLength(1);
      const remainingConflict = replacement.actions[1]?.conflict;
      if (remainingConflict == null) {
        throw new Error('Expected the second conflict to remain unresolved');
      }
      expect(payloads[0]?.conflict).toBe(remainingConflict);
      const final = instance.resolveConflict(1, 'current');
      expect(final?.actions.every((action) => action == null)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });
}

test('uncontrolled conflict resolution retains adopted rows until highlighting finishes', async () => {
  const fixture = await createFixture(false, false);
  const { instance, annotationText, markerCount } = fixture;
  try {
    const adopted = instance.getRenderedDiffForTest();
    const initialMarkers = markerCount();
    fixture.click(0);
    expect(fixture.payloads).toHaveLength(1);
    expect(fixture.renderPhases).toEqual([]);
    expect(instance.getRenderedDiffForTest()).toBe(adopted);
    expect(annotationText()).toBe('annotation:A');
    expect(markerCount()).toBe(initialMarkers);
    const request = await fixture.getRequest(2);
    fixture.respond(request, request.diff);
    await waitFor(() => instance.getRenderedDiffForTest() !== adopted);
    expect(fixture.renderPhases).toEqual(['update']);
    expect(markerCount()).toBe(initialMarkers / 2);
    expect(fixture.button(0)).toBeNull();
    expect(fixture.button(1)).not.toBeNull();
  } finally {
    fixture.cleanup();
  }
});

test('uncontrolled conflicts can both resolve while the first highlight is pending', async () => {
  const fixture = await createFixture(false, false);
  const { instance, markerCount } = fixture;
  try {
    const adopted = instance.getRenderedDiffForTest();
    const initialMarkers = markerCount();
    fixture.click(0);
    const firstRequest = await fixture.getRequest(2);
    fixture.click(1);
    expect(
      fixture.payloads.map((payload) => payload.conflict.startLineIndex)
    ).toEqual([1, 3]);
    expect(fixture.renderPhases).toEqual([]);
    expect(instance.getRenderedDiffForTest()).toBe(adopted);
    expect(markerCount()).toBe(initialMarkers);

    fixture.respond(firstRequest, firstRequest.diff);
    await wait();
    expect(instance.getRenderedDiffForTest()).toBe(adopted);
    expect(markerCount()).toBe(initialMarkers);
    const finalRequest = await fixture.getRequest(3);
    fixture.respond(finalRequest, finalRequest.diff);
    await waitFor(() => instance.getRenderedDiffForTest() !== adopted);
    expect(markerCount()).toBe(0);
    expect(fixture.button(0)).toBeNull();
    expect(fixture.button(1)).toBeNull();
    expect(fixture.renderPhases).toEqual(['update']);
  } finally {
    fixture.cleanup();
  }
});

test('controlled replacement cannot reuse a retained conflict button for a different conflict', async () => {
  const fixture = await createFixture(false, true);
  const { instance, initial } = fixture;
  try {
    const resolved = instance.resolveConflict(0, 'current');
    if (resolved == null) {
      throw new Error('Expected a resolved first conflict');
    }
    // A controlled caller can reparse its new file and restart conflict indices.
    const replacement = parseMergeConflictDiffFromFile(resolved.file);
    expect(replacement.actions[0]?.conflict.startLineIndex).toBe(3);
    instance.render({ ...replacement, lineAnnotations: [] });
    expect(instance.fileDiff).toBe(replacement.fileDiff);
    expect(instance.getRenderedDiffForTest()).toBe(initial.fileDiff);
    fixture.click(0);
    expect(fixture.payloads).toEqual([]);

    fixture.respond(await fixture.getRequest(2), replacement.fileDiff);
    await waitFor(
      () => instance.getRenderedDiffForTest() === replacement.fileDiff
    );
    fixture.click(0);
    expect(fixture.payloads).toHaveLength(1);
    expect(fixture.payloads[0]?.conflict.startLineIndex).toBe(3);
  } finally {
    fixture.cleanup();
  }
});
