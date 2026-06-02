import { afterEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import type * as SvelteRuntime from 'svelte';
import { compile } from 'svelte/compiler';

// Bun resolves the public `svelte` export to the server entry in this test
// environment, so the component test imports the client runtime directly.
// @ts-expect-error Svelte does not publish declarations for this source path.
import * as svelteClient from '../node_modules/svelte/src/index-client.js';
import {
  type ReviewDiffCommentTarget,
  type ReviewDiffCommentThread,
  type ReviewDiffHandle,
  type ReviewDiffProps,
  type ReviewDiffStateFile,
  type ReviewDiffVirtualFile,
} from '../src/svelte/review/index';

const { flushSync, mount, unmount } = svelteClient as typeof SvelteRuntime;

const REVIEW_DIFF_SOURCE_URL = new URL(
  '../src/svelte/review/ReviewDiff.svelte',
  import.meta.url
);
const COMPILED_COMPONENT_URL = new URL(
  '../src/svelte/review/.ReviewDiff.svelte.test.generated.mjs',
  import.meta.url
);
const COMPILED_HARNESS_URL = new URL(
  '../src/svelte/review/.ReviewDiff.harness.svelte.test.generated.mjs',
  import.meta.url
);
const COMPILED_COMPONENT_IMPORT_PATH =
  './.ReviewDiff.svelte.test.generated.mjs';

interface InstalledDom {
  cleanup(): void;
}

let installedDom: InstalledDom | undefined;
let nextCompiledModuleVersion = 0;
interface ReviewDiffTestHarnessHandle {
  clearCommentThreads?(): void;
  useSecondRenderer?(): void;
}

let mountedComponent:
  | (Partial<ReviewDiffHandle> & ReviewDiffTestHarnessHandle)
  | undefined;

afterEach(async () => {
  if (mountedComponent != null) {
    await unmount(mountedComponent);
    mountedComponent = undefined;
  }

  installedDom?.cleanup();
  installedDom = undefined;

  if (existsSync(COMPILED_COMPONENT_URL)) {
    unlinkSync(COMPILED_COMPONENT_URL);
  }
  if (existsSync(COMPILED_HARNESS_URL)) {
    unlinkSync(COMPILED_HARNESS_URL);
  }
});

describe('ReviewDiff.svelte', () => {
  test('mounts the review region and exposes hydration controls', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    const requestedHydration: string[] = [];

    mountedComponent = mount(ReviewDiff, {
      target,
      props: {
        files: [
          createVirtualReviewFile('src/app.ts'),
          createStateReviewFile('assets/logo.png'),
        ],
        labels: { ariaLabel: 'Review changes' },
        onHydrationRequested: (fileId) => {
          requestedHydration.push(fileId);
        },
      },
    });
    flushSync();

    const region = target.querySelector('[data-pierre-review-diff]');
    expect(region).toBeInstanceOf(HTMLElement);
    expect(region?.getAttribute('aria-label')).toBe('Review changes');
    expect(region?.getAttribute('role')).toBe('region');
    const collapseButton = await waitForElement<HTMLButtonElement>(
      region,
      '.pierre-review-diff__collapse-button'
    );
    expect(collapseButton).toBeInstanceOf(HTMLButtonElement);
    expect(collapseButton?.getAttribute('aria-label')).toBe('Collapse file');
    expect(
      region?.querySelector('.pierre-review-diff__state-badge')?.textContent
    ).toBe('Binary file');
    const binaryContainer = region?.querySelector(
      'diffs-container[data-file-id="assets/logo.png"]'
    );
    const binaryCollapseButton = binaryContainer?.querySelector(
      '.pierre-review-diff__collapse-button'
    );
    expect(binaryCollapseButton).toBeInstanceOf(HTMLButtonElement);
    expect(binaryCollapseButton?.getAttribute('aria-label')).toBe(
      'Binary file'
    );
    expect(
      (binaryCollapseButton as HTMLButtonElement | undefined)?.disabled
    ).toBe(true);
    expect(binaryCollapseButton?.textContent).toBe('+');
    expect(binaryContainer?.querySelector('[data-deletions-count]')).toBeNull();
    expect(binaryContainer?.querySelector('[data-additions-count]')).toBeNull();

    const reviewDiff = mountedComponent as ReviewDiffHandle;
    expect(typeof reviewDiff.hydrateFile).toBe('function');
    expect(typeof reviewDiff.applyCollapseModeToLoaded).toBe('function');

    const stalePatch = createVirtualReviewFile(
      'src/app.ts',
      'const stale = false;',
      'const stale = true;'
    ).patch;
    reviewDiff.hydrateFile(
      'src/app.ts',
      stalePatch,
      'const stale = false;\n',
      'const stale = true;\n'
    );
    await waitFor(() => region?.querySelector('diffs-container') != null);
    expect(getComposedText(region).includes('const stale = true;')).toBe(false);

    reviewDiff.hydrateFile(
      'src/app.ts',
      createVirtualReviewFile('src/app.ts').patch,
      'const hydrated = false;\n',
      'const hydrated = true;\n'
    );
    expect(() => {
      reviewDiff.applyCollapseModeToLoaded(false);
    }).not.toThrow();
    await waitFor(() =>
      getComposedText(region).includes('const hydrated = true;')
    );
    await tickFrames(2);
    expect(getComposedText(region).includes('const hydrated = true;')).toBe(
      true
    );

    const currentCollapseButton = await waitForElement<HTMLButtonElement>(
      region,
      '.pierre-review-diff__collapse-button[aria-label="Collapse file"]'
    );
    currentCollapseButton.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true })
    );
    const expandedButton = await waitForElement<HTMLButtonElement>(
      region,
      '.pierre-review-diff__collapse-button[aria-label="Expand file"]'
    );
    expect(expandedButton).toBeInstanceOf(HTMLButtonElement);

    const container = region?.querySelector('diffs-container');
    expect(container?.getAttribute('data-file-id')).toBe('src/app.ts');
    const separatorTrigger = document.createElement('button');
    separatorTrigger.dataset.separatorContent = '';
    container?.shadowRoot?.appendChild(separatorTrigger);
    separatorTrigger.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, composed: true })
    );
    expect(requestedHydration).toEqual(['src/app.ts']);

    const unmodifiedTrigger = document.createElement('button');
    unmodifiedTrigger.dataset.unmodifiedLines = '';
    container?.shadowRoot?.appendChild(unmodifiedTrigger);
    unmodifiedTrigger.dispatchEvent(
      new window.MouseEvent('click', { bubbles: true, composed: true })
    );
    expect(requestedHydration).toEqual(['src/app.ts', 'src/app.ts']);
  });

  test('renders controlled comment threads through renderCommentThread', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    const thread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-1',
      target: {
        fileId: 'src/app.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Please keep this review note visible.' },
    };

    mountedComponent = mount(ReviewDiff, {
      target,
      props: {
        files: [createVirtualReviewFile('src/app.ts')],
        commentThreads: [thread],
        renderCommentThread: (currentThread, context) => {
          const metadata = currentThread.metadata as { body: string };
          const wrapper = document.createElement('article');
          wrapper.dataset.reviewCommentThread = currentThread.id;
          wrapper.textContent = `${context.file.id}:${context.target.side}:${metadata.body}`;
          return wrapper;
        },
      },
    });
    flushSync();

    const region = target.querySelector('[data-pierre-review-diff]');
    await waitFor(() =>
      getComposedText(region).includes('Please keep this review note visible.')
    );

    expect(getComposedText(region)).toContain(
      'src/app.ts:additions:Please keep this review note visible.'
    );
  });

  test('does not expose controlled comments to renderAnnotation without renderCommentThread', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    let renderAnnotationCalls = 0;

    mountedComponent = mount(ReviewDiff, {
      target,
      props: {
        files: [createVirtualReviewFile('src/app.ts')],
        commentThreads: [
          {
            id: 'thread-1',
            target: {
              fileId: 'src/app.ts',
              side: 'additions',
              lineNumber: 1,
            },
            metadata: { body: 'controlled comment' },
          },
        ],
        codeViewOptions: {
          renderAnnotation: () => {
            renderAnnotationCalls += 1;
            const wrapper = document.createElement('article');
            wrapper.textContent = 'unexpected renderAnnotation comment';
            return wrapper;
          },
        },
      },
    });
    flushSync();

    const region = await waitForElement<HTMLElement>(
      target,
      '[data-pierre-review-diff]'
    );
    const container = await waitForElement<HTMLElement>(
      region,
      'diffs-container[data-file-id="src/app.ts"]'
    );
    await waitFor(() => container.shadowRoot?.querySelector('[data-code]'));
    await tickFrames(2);

    expect(renderAnnotationCalls).toBe(0);
    expect(getComposedText(region)).not.toContain(
      'unexpected renderAnnotation comment'
    );
  });

  test('updates rendered comments when renderCommentThread changes and clears empty threads', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const Harness = await loadReviewDiffHarnessComponent(`
      <script lang="ts">
        import ReviewDiff from './.ReviewDiff.svelte.test.generated.mjs';

        const files = [createVirtualReviewFile('src/app.ts')];
        let commentThreads = $state([
          {
            id: 'thread-1',
            target: {
              fileId: 'src/app.ts',
              side: 'additions',
              lineNumber: 1,
            },
            metadata: { body: 'same controlled thread' },
          },
        ]);
        let renderer = $state<'first' | 'second'>('first');
        const renderCommentThread = $derived(
          renderer === 'first' ? renderFirstCommentThread : renderSecondCommentThread
        );

        export function useSecondRenderer(): void {
          renderer = 'second';
        }

        export function clearCommentThreads(): void {
          commentThreads = [];
        }

        function renderFirstCommentThread(thread): HTMLElement {
          const wrapper = document.createElement('article');
          wrapper.dataset.reviewCommentThread = thread.id;
          wrapper.textContent = 'first:' + thread.metadata.body;
          return wrapper;
        }

        function renderSecondCommentThread(thread): HTMLElement {
          const wrapper = document.createElement('article');
          wrapper.dataset.reviewCommentThread = thread.id;
          wrapper.textContent = 'second:' + thread.metadata.body;
          return wrapper;
        }

        function createVirtualReviewFile(id: string) {
          return {
            id,
            kind: 'virtual',
            path: id,
            oldPath: null,
            status: 'modified',
            group: 'unstaged',
            patch: [
              'diff --git a/' + id + ' b/' + id,
              'index 1111111..2222222 100644',
              '--- a/' + id,
              '+++ b/' + id,
              '@@ -1 +1 @@',
              '-const value = false;',
              '+const value = true;',
              '',
            ].join('\\n'),
            byteSize: 20,
            lineCount: 1,
            contextLines: 3,
            canExpandContext: true,
          };
        }
      </script>

      <ReviewDiff {files} {commentThreads} {renderCommentThread} />
    `);

    mountedComponent = mount(Harness, { target });
    flushSync();

    const region = await waitForElement<HTMLElement>(
      target,
      '[data-pierre-review-diff]'
    );
    await tickFrames(2);
    await waitFor(() =>
      getComposedText(region).includes('first:same controlled thread')
    );

    mountedComponent?.useSecondRenderer?.();
    flushSync();

    await waitFor(() =>
      getComposedText(region).includes('second:same controlled thread')
    );
    expect(getComposedText(region)).not.toContain(
      'first:same controlled thread'
    );

    mountedComponent?.clearCommentThreads?.();
    flushSync();
    await tickFrames(2);

    await waitFor(
      () => !getComposedText(region).includes('same controlled thread')
    );
  });

  test('requests a new comment thread from the gutter utility', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    const requestedTargets: ReviewDiffCommentTarget[] = [];

    mountedComponent = mount(ReviewDiff, {
      target,
      props: {
        files: [createVirtualReviewFile('src/app.ts')],
        onCommentThreadAddRequested: (commentTarget) => {
          requestedTargets.push(commentTarget);
        },
      },
    });
    flushSync();

    const region = target.querySelector('[data-pierre-review-diff]');
    const container = await waitForElement<HTMLElement>(
      region,
      'diffs-container[data-file-id="src/app.ts"]'
    );
    await waitFor(() => container.shadowRoot?.querySelector('[data-code]'));
    await tickFrames(2);

    const additionNumber = await waitForElement<HTMLElement>(
      container.shadowRoot,
      '[data-column-number="1"][data-line-type="change-addition"]'
    );
    dispatchPointer(additionNumber, 'pointerdown');
    const utilityButton = await waitForElement<HTMLButtonElement>(
      container,
      '[data-utility-button]'
    );

    expect(utilityButton.getAttribute('aria-label')).toBe(
      'Add line annotation'
    );

    utilityButton.click();
    dispatchPointer(utilityButton, 'pointerdown');
    dispatchPointer(utilityButton, 'pointerup');
    utilityButton.click();

    expect(requestedTargets).toEqual([
      {
        fileId: 'src/app.ts',
        side: 'additions',
        lineNumber: 1,
      },
      {
        fileId: 'src/app.ts',
        side: 'additions',
        lineNumber: 1,
      },
    ]);
  });

  test('does not show the add-comment gutter utility for state files', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    const requestedTargets: ReviewDiffCommentTarget[] = [];

    mountedComponent = mount(ReviewDiff, {
      target,
      props: {
        files: [createStateReviewFile('assets/logo.png')],
        onCommentThreadAddRequested: (commentTarget) => {
          requestedTargets.push(commentTarget);
        },
      },
    });
    flushSync();

    const region = target.querySelector('[data-pierre-review-diff]');
    const container = await waitForElement<HTMLElement>(
      region,
      'diffs-container[data-file-id="assets/logo.png"]'
    );
    await tickFrames(2);

    expect(container.querySelector('[data-utility-button]')).toBeNull();
    expect(
      container.shadowRoot?.querySelector('[data-utility-button]')
    ).toBeNull();
    expect(requestedTargets).toEqual([]);
  });

  test('does not show the add-comment gutter utility for notice items', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    const requestedTargets: ReviewDiffCommentTarget[] = [];

    mountedComponent = mount(ReviewDiff, {
      target,
      props: {
        files: [],
        notices: ['Review notice without line-level comments.'],
        onCommentThreadAddRequested: (commentTarget) => {
          requestedTargets.push(commentTarget);
        },
      },
    });
    flushSync();

    const region = target.querySelector('[data-pierre-review-diff]');
    const container = await waitForElement<HTMLElement>(
      region,
      'diffs-container[data-file-id="__pierre_review_notice:0"]'
    );
    await waitFor(() => container.shadowRoot?.querySelector('[data-code]'));
    await tickFrames(2);

    const lineNumber = await waitForElement<HTMLElement>(
      container.shadowRoot,
      '[data-column-number="1"]'
    );
    dispatchPointer(lineNumber, 'pointerdown');
    await tickFrames(1);

    expect(container.querySelector('[data-utility-button]')).toBeNull();
    expect(
      container.shadowRoot?.querySelector('[data-utility-button]')
    ).toBeNull();
    expect(requestedTargets).toEqual([]);
  });

  test('prefers review comment add over a custom gutter utility renderer', async () => {
    installedDom = installDom();
    const target = document.createElement('div');
    document.body.appendChild(target);
    const ReviewDiff = await loadReviewDiffComponent();
    const requestedTargets: ReviewDiffCommentTarget[] = [];
    let customRendererCalls = 0;

    expect(() => {
      mountedComponent = mount(ReviewDiff, {
        target,
        props: {
          files: [createVirtualReviewFile('src/app.ts')],
          codeViewOptions: {
            renderGutterUtility: () => {
              customRendererCalls += 1;
              const button = document.createElement('button');
              button.type = 'button';
              button.dataset.customGutterUtility = '';
              return button;
            },
          },
          onCommentThreadAddRequested: (commentTarget) => {
            requestedTargets.push(commentTarget);
          },
        },
      });
      flushSync();
    }).not.toThrow();

    const region = target.querySelector('[data-pierre-review-diff]');
    const container = await waitForElement<HTMLElement>(
      region,
      'diffs-container[data-file-id="src/app.ts"]'
    );
    await waitFor(() => container.shadowRoot?.querySelector('[data-code]'));
    await tickFrames(2);

    const additionNumber = await waitForElement<HTMLElement>(
      container.shadowRoot,
      '[data-column-number="1"][data-line-type="change-addition"]'
    );
    dispatchPointer(additionNumber, 'pointerdown');
    const utilityButton = await waitForElement<HTMLButtonElement>(
      container,
      '[data-utility-button]'
    );
    dispatchPointer(utilityButton, 'pointerdown');
    dispatchPointer(utilityButton, 'pointerup');
    utilityButton.click();

    expect(customRendererCalls).toBe(0);
    expect(requestedTargets).toEqual([
      {
        fileId: 'src/app.ts',
        side: 'additions',
        lineNumber: 1,
      },
    ]);
  });
});

function dispatchPointer(
  target: EventTarget,
  type: string,
  init: PointerEventInit = {}
): PointerEvent {
  const event = new window.PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: 1,
    pointerType: 'touch',
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

function installDom(): InstalledDom {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost',
  });
  const originalValues = {
    cancelAnimationFrame: Reflect.get(globalThis, 'cancelAnimationFrame'),
    CSSStyleSheet: Reflect.get(globalThis, 'CSSStyleSheet'),
    customElements: Reflect.get(globalThis, 'customElements'),
    document: Reflect.get(globalThis, 'document'),
    DocumentFragment: Reflect.get(globalThis, 'DocumentFragment'),
    Element: Reflect.get(globalThis, 'Element'),
    HTMLButtonElement: Reflect.get(globalThis, 'HTMLButtonElement'),
    HTMLDivElement: Reflect.get(globalThis, 'HTMLDivElement'),
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
    HTMLPreElement: Reflect.get(globalThis, 'HTMLPreElement'),
    HTMLStyleElement: Reflect.get(globalThis, 'HTMLStyleElement'),
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    navigator: Reflect.get(globalThis, 'navigator'),
    Node: Reflect.get(globalThis, 'Node'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
    requestAnimationFrame: Reflect.get(globalThis, 'requestAnimationFrame'),
    ResizeObserver: Reflect.get(globalThis, 'ResizeObserver'),
    SVGElement: Reflect.get(globalThis, 'SVGElement'),
    Text: Reflect.get(globalThis, 'Text'),
    window: Reflect.get(globalThis, 'window'),
  };

  class MockResizeObserver {
    observe(_target: Element): void {}
    unobserve(_target: Element): void {}
    disconnect(): void {}
  }

  class MockCSSStyleSheet {
    replaceSync(_css: string): void {}
  }

  class MockPointerEvent extends dom.window.MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? '';
    }
  }

  let nextFrameId = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  const originalGetBoundingClientRect =
    dom.window.HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(
    dom.window.HTMLElement.prototype,
    'getBoundingClientRect',
    {
      configurable: true,
      value: () => ({
        bottom: 800,
        height: 800,
        left: 0,
        right: 1200,
        top: 0,
        width: 1200,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      }),
    }
  );

  Object.assign(globalThis, {
    cancelAnimationFrame: ((id: number) => {
      const timeout = frames.get(id);
      if (timeout != null) {
        clearTimeout(timeout);
        frames.delete(id);
      }
    }) as typeof cancelAnimationFrame,
    CSSStyleSheet: MockCSSStyleSheet,
    customElements: dom.window.customElements,
    document: dom.window.document,
    DocumentFragment: dom.window.DocumentFragment,
    Element: dom.window.Element,
    HTMLButtonElement: dom.window.HTMLButtonElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLElement: dom.window.HTMLElement,
    HTMLPreElement: dom.window.HTMLPreElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    MouseEvent: dom.window.MouseEvent,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    PointerEvent: MockPointerEvent,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextFrameId;
      const timeout = setTimeout(() => {
        frames.delete(id);
        callback(performance.now());
      }, 0);
      frames.set(id, timeout);
      return id;
    }) as typeof requestAnimationFrame,
    ResizeObserver: MockResizeObserver,
    SVGElement: dom.window.SVGElement,
    Text: dom.window.Text,
    window: dom.window,
  });

  Object.assign(dom.window, { PointerEvent: MockPointerEvent });

  return {
    cleanup() {
      for (const timeout of frames.values()) {
        clearTimeout(timeout);
      }
      frames.clear();

      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'getBoundingClientRect',
        {
          configurable: true,
          value: originalGetBoundingClientRect,
        }
      );
      dom.window.close();
    },
  };
}

async function waitForElement<T extends Element>(
  root: ParentNode | null | undefined,
  selector: string
): Promise<T> {
  return waitFor(() => root?.querySelector(selector) as T | null);
}

async function waitFor<T>(
  predicate: () => T | false | null | undefined,
  timeoutMs = 2_000
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = predicate();
    if (value !== false && value != null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for ReviewDiff test condition');
}

async function tickFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  }
}

function getComposedText(node: Node | ShadowRoot | null | undefined): string {
  if (node == null) {
    return '';
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  let text = node instanceof Element ? getComposedText(node.shadowRoot) : '';
  for (const child of Array.from(node.childNodes)) {
    text += getComposedText(child);
  }

  return text;
}

async function loadReviewDiffHarnessComponent(
  source: string
): Promise<
  Parameters<
    typeof mount<Record<string, never>, ReviewDiffTestHarnessHandle>
  >[0]
> {
  const componentVersion = writeReviewDiffComponent();
  const sourceWithCacheBustedReviewDiff = source.replaceAll(
    COMPILED_COMPONENT_IMPORT_PATH,
    `${COMPILED_COMPONENT_IMPORT_PATH}?version=${componentVersion}`
  );

  const compiled = compile(sourceWithCacheBustedReviewDiff, {
    filename: 'ReviewDiffHarness.svelte',
    generate: 'client',
  });
  writeFileSync(COMPILED_HARNESS_URL, compiled.js.code);

  const compiledModule = (await import(
    `${COMPILED_HARNESS_URL.href}?version=${++nextCompiledModuleVersion}`
  )) as {
    default: Parameters<
      typeof mount<Record<string, never>, ReviewDiffTestHarnessHandle>
    >[0];
  };

  return compiledModule.default;
}

async function loadReviewDiffComponent(): Promise<
  Parameters<typeof mount<ReviewDiffProps, ReviewDiffHandle>>[0]
> {
  const componentVersion = writeReviewDiffComponent();
  const compiledModule = (await import(
    `${COMPILED_COMPONENT_URL.href}?version=${componentVersion}`
  )) as {
    default: Parameters<typeof mount<ReviewDiffProps, ReviewDiffHandle>>[0];
  };

  return compiledModule.default;
}

function writeReviewDiffComponent(): number {
  const source = readFileSync(REVIEW_DIFF_SOURCE_URL, 'utf8');
  const compiled = compile(source, {
    filename: 'ReviewDiff.svelte',
    generate: 'client',
  });
  const code = compiled.js.code.replace(
    "import { onMount } from 'svelte';",
    "import { onMount } from '../../../node_modules/svelte/src/index-client.js';"
  );
  writeFileSync(COMPILED_COMPONENT_URL, code);

  return ++nextCompiledModuleVersion;
}

function createVirtualReviewFile(
  id: string,
  oldLine = 'const value = false;',
  newLine = 'const value = true;'
): ReviewDiffVirtualFile {
  return {
    id,
    kind: 'virtual',
    path: id,
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    patch: [
      `diff --git a/${id} b/${id}`,
      'index 1111111..2222222 100644',
      `--- a/${id}`,
      `+++ b/${id}`,
      '@@ -1 +1 @@',
      `-${oldLine}`,
      `+${newLine}`,
      '',
    ].join('\n'),
    byteSize: 20,
    lineCount: 1,
    contextLines: 3,
    canExpandContext: true,
  };
}

function createStateReviewFile(id: string): ReviewDiffStateFile {
  return {
    id,
    kind: 'state',
    path: id,
    oldPath: null,
    status: 'binary',
    group: 'unstaged',
    reason: 'binary_file',
    byteSize: 1024,
    message: null,
  };
}
