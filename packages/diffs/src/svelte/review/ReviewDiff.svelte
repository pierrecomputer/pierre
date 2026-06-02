<script lang="ts" generics="TCommentMetadata = unknown">
  import { onMount } from 'svelte';

  import { CodeView, type CodeViewOptions } from '../../components/CodeView.js';
  import { createGutterUtilityButtonElement } from '../../utils/createGutterUtilityElement.js';
  import type {
    CodeViewItem,
    DiffLineAnnotation,
    LineAnnotation,
    SelectedLineRange,
  } from '../../types.js';
  import {
    applyReviewDiffCommentThreadGroupsToItems,
    isReviewDiffCommentableFile,
  } from './commentThreads.js';
  import { createReviewDiffItems } from './fileItems.js';
  import { resolveReviewDiffLabels } from './labels.js';
  import {
    REVIEW_DIFF_CLASS,
    REVIEW_DIFF_UNSAFE_CSS,
  } from './reviewDiffTheme.js';
  import {
    incrementVersion,
    prepareSyncedReviewDiffItems,
  } from './syncReviewDiffItems.js';
  import type {
    ResolvedReviewDiffLabels,
    ReviewDiffCommentAnnotationMetadata,
    ReviewDiffCommentTarget,
    ReviewDiffFile,
    ReviewDiffProps,
    ReviewDiffStateFile,
    ReviewDiffTextFile,
    ReviewDiffVirtualFile,
  } from './types.js';
  import {
    acquireReviewWorkerPool,
    releaseReviewWorkerPool,
  } from './workerPool.js';

  const MAX_SYNC_UPDATES = 80;

  type ReviewDiffCommentMetadata =
    ReviewDiffCommentAnnotationMetadata<TCommentMetadata>;

  let {
    files,
    notices = [],
    wrap = false,
    collapsed = false,
    diffStyle = 'split',
    labels,
    onHydrationRequested,
    class: className = '',
    codeViewOptions,
    commentThreads,
    renderCommentThread,
    onCommentThreadAddRequested,
  }: ReviewDiffProps<TCommentMetadata> = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let viewer = $state<CodeView<ReviewDiffCommentMetadata> | undefined>(
    undefined
  );
  let hydratedFilesById = $state(new Map<string, ReviewDiffTextFile>());
  let loadedItems = new Map<string, CodeViewItem<ReviewDiffCommentMetadata>>();

  const resolvedLabels: ResolvedReviewDiffLabels = $derived(
    resolveReviewDiffLabels(labels)
  );
  const resolvedFiles: ReviewDiffFile[] = $derived(
    files.map((file) => {
      if (file.kind !== 'virtual') {
        return file;
      }
      const hydrated = hydratedFilesById.get(file.id);
      return hydrated?.patch === file.patch ? hydrated : file;
    })
  );
  const resolvedCommentThreads = $derived(commentThreads ?? []);
  const renderedCommentThreads = $derived(
    renderCommentThread == null ? [] : resolvedCommentThreads
  );
  const baseItems: CodeViewItem<ReviewDiffCommentMetadata>[] = $derived(
    createReviewDiffItems<TCommentMetadata>({
      files: resolvedFiles,
      notices,
      collapsed,
      labels: resolvedLabels,
    })
  );
  const items: CodeViewItem<ReviewDiffCommentMetadata>[] = $derived(
    applyReviewDiffCommentThreadGroupsToItems(
      baseItems,
      resolvedFiles,
      renderedCommentThreads,
      renderCommentThread
    )
  );
  const fileById: Map<string, ReviewDiffFile> = $derived(
    new Map(resolvedFiles.map((file) => [file.id, file]))
  );
  const classValue = $derived(
    className.length > 0 ? `${REVIEW_DIFF_CLASS} ${className}` : REVIEW_DIFF_CLASS
  );
  const renderCommentAnnotation = $derived(
    renderCommentThread == null
      ? undefined
      : createRenderCommentAnnotation(renderCommentThread)
  );

  type ReviewDiffItemContext = {
    item: CodeViewItem<ReviewDiffCommentMetadata>;
  };

  onMount(() => {
    if (host == null) {
      return;
    }

    const workerPool = acquireReviewWorkerPool();
    const nextViewer = new CodeView<ReviewDiffCommentMetadata>(
      createCodeViewOptions(),
      workerPool
    );

    nextViewer.setup(host);
    viewer = nextViewer;
    applyItems(items);

    return () => {
      viewer = undefined;
      nextViewer.cleanUp();
      if (workerPool != null) {
        releaseReviewWorkerPool();
      }
    };
  });

  $effect(() => {
    viewer?.setOptions(createCodeViewOptions());
  });

  $effect(() => {
    applyItems(items);
  });

  export function applyCollapseModeToLoaded(nextCollapsed: boolean): void {
    if (viewer == null) {
      return;
    }

    const nextItems = Array.from(loadedItems.values(), (item) => ({
      ...item,
      collapsed: nextCollapsed,
      version: incrementVersion(item.version),
    }));

    loadedItems = createLoadedItemMap(nextItems);
    viewer.setItems(nextItems);
  }

  export function hydrateFile(
    fileId: string,
    patch: string,
    oldText: string,
    newText: string
  ): void {
    const file = fileById.get(fileId);
    if (viewer == null || file?.kind !== 'virtual' || file.patch !== patch) {
      return;
    }

    const textFile = createHydratedTextFile(file, patch, oldText, newText);
    const [baseItem] = createReviewDiffItems<TCommentMetadata>({
      files: [textFile],
      collapsed: loadedItems.get(fileId)?.collapsed ?? collapsed,
      labels: resolvedLabels,
    });
    const [item] =
      baseItem == null
        ? []
        : applyReviewDiffCommentThreadGroupsToItems(
            [baseItem],
            [textFile],
            renderedCommentThreads,
            renderCommentThread
          );

    if (item == null) {
      return;
    }

    if (!viewer.updateItem(item)) {
      return;
    }

    const currentFile = fileById.get(fileId);
    if (
      currentFile == null ||
      currentFile.kind !== 'virtual' ||
      currentFile.patch !== patch
    ) {
      return;
    }

    hydratedFilesById = new Map(hydratedFilesById).set(fileId, textFile);
    loadedItems.set(item.id, item);
    viewer.render(true);
  }

  function createCodeViewOptions(): CodeViewOptions<ReviewDiffCommentMetadata> {
    return {
      ...codeViewOptions,
      unsafeCSS: mergeUnsafeCSS(
        REVIEW_DIFF_UNSAFE_CSS,
        codeViewOptions?.unsafeCSS
      ),
      diffStyle,
      overflow: wrap ? 'wrap' : 'scroll',
      stickyHeaders: true,
      hunkSeparators: 'line-info',
      formatUnmodifiedLines: resolvedLabels.formatUnmodifiedLines,
      onPostRender: handlePostRender,
      renderHeaderPrefix,
      renderHeaderMetadata,
      renderAnnotation: renderCommentAnnotation ?? codeViewOptions?.renderAnnotation,
      renderGutterUtility:
        onCommentThreadAddRequested == null
          ? codeViewOptions?.renderGutterUtility
          : renderCommentGutterUtility,
      enableGutterUtility:
        onCommentThreadAddRequested == null
          ? codeViewOptions?.enableGutterUtility
          : true,
      onGutterUtilityClick:
        onCommentThreadAddRequested == null
          ? codeViewOptions?.onGutterUtilityClick
          : handleCommentThreadAddRequested,
    };
  }

  // Converts controlled comment annotations into user-provided DOM content.
  function createRenderCommentAnnotation(
    renderThread: NonNullable<
      ReviewDiffProps<TCommentMetadata>['renderCommentThread']
    >
  ): CodeViewOptions<ReviewDiffCommentMetadata>['renderAnnotation'] {
    return (
      annotation:
        | DiffLineAnnotation<ReviewDiffCommentMetadata>
        | LineAnnotation<ReviewDiffCommentMetadata>
    ) => {
      if (!('side' in annotation)) {
        return undefined;
      }

      return renderThread(annotation.metadata.thread, {
        file: annotation.metadata.file,
        target: annotation.metadata.target,
        thread: annotation.metadata.thread,
      });
    };
  }

  // Renders ReviewDiff's built-in add-comment button only for line-commentable items.
  function renderCommentGutterUtility(
    _getHoveredLine: () => unknown,
    context: ReviewDiffItemContext
  ): HTMLElement | undefined {
    const item = context.item;
    if (item.type !== 'diff') {
      return undefined;
    }

    const file = fileById.get(item.id);
    if (file == null || !isReviewDiffCommentableFile(file)) {
      return undefined;
    }

    return createGutterUtilityButtonElement();
  }

  // Normalizes CodeView gutter selections into ReviewDiff comment targets.
  function handleCommentThreadAddRequested(
    range: SelectedLineRange,
    context?: ReviewDiffItemContext
  ): void {
    const item = context?.item;
    if (item == null) {
      return;
    }

    const file = fileById.get(item.id);
    if (file == null || !isReviewDiffCommentableFile(file)) {
      return;
    }

    const side = range.endSide ?? range.side;
    if (side == null) {
      return;
    }

    const target: ReviewDiffCommentTarget = {
      fileId: file.id,
      side,
      lineNumber: range.end,
    };

    onCommentThreadAddRequested?.(target, { file, target });
  }

  function applyItems(
    nextItems: readonly CodeViewItem<ReviewDiffCommentMetadata>[]
  ): void {
    if (viewer == null) {
      return;
    }

    const { orderChanged, changedCount, syncedItems } =
      prepareSyncedReviewDiffItems(loadedItems, nextItems);

    if (orderChanged || changedCount > MAX_SYNC_UPDATES) {
      loadedItems = createLoadedItemMap(syncedItems);
      viewer.setItems(syncedItems);
      return;
    }

    for (const item of nextItems) {
      const previous = loadedItems.get(item.id);
      if (
        previous != null &&
        (previous.version !== item.version ||
          previous.collapsed !== item.collapsed)
      ) {
        viewer.updateItem(item);
      }
    }

    loadedItems = createLoadedItemMap(syncedItems);
  }

  function renderHeaderPrefix(
    _metadata: unknown,
    context?: ReviewDiffItemContext
  ): HTMLElement {
    const item = context?.item;
    if (item == null) {
      return document.createElement('span');
    }

    const file = fileById.get(item.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pierre-review-diff__collapse-button';

    if (file?.kind === 'state') {
      button.textContent = '+';
      button.disabled = true;
      button.setAttribute('aria-label', resolvedLabels.binaryFile);
      button.title = resolvedLabels.binaryFile;
      return button;
    }

    button.textContent = item.collapsed ? '+' : '-';
    button.setAttribute(
      'aria-label',
      item.collapsed ? resolvedLabels.expandFile : resolvedLabels.collapseFile
    );

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleLoadedItemCollapsed(item.id);
    });

    return button;
  }

  function renderHeaderMetadata(
    _metadata: unknown,
    context?: ReviewDiffItemContext
  ): HTMLElement | undefined {
    const file = context == null ? undefined : fileById.get(context.item.id);
    if (file?.kind !== 'state') {
      return undefined;
    }

    const badge = document.createElement('span');
    badge.className = 'pierre-review-diff__state-badge';
    badge.textContent = file.message ?? getStateReasonLabel(file, resolvedLabels);
    badge.title = badge.textContent ?? '';
    return badge;
  }

  function handlePostRender(
    node: HTMLElement,
    instance: unknown,
    phase: unknown,
    context?: ReviewDiffItemContext
  ): void {
    if (context != null) {
      node.dataset.fileId = context.item.id;
    }

    const forwardedPostRender = codeViewOptions?.onPostRender as
      | ((
          node: HTMLElement,
          instance: unknown,
          phase: unknown,
          context?: ReviewDiffItemContext
        ) => void)
      | undefined;
    forwardedPostRender?.(node, instance, phase, context);
  }

  function toggleLoadedItemCollapsed(itemId: string): void {
    const item = loadedItems.get(itemId);
    if (
      viewer == null ||
      item == null ||
      fileById.get(itemId)?.kind === 'state'
    ) {
      return;
    }

    const nextItem = {
      ...item,
      collapsed: !item.collapsed,
      version: incrementVersion(item.version),
    };

    loadedItems.set(itemId, nextItem);
    viewer.updateItem(nextItem);
  }

  function handleHydrationClick(event: MouseEvent): void {
    const fileId = getHydrationFileId(event);
    if (fileId != null && fileId.length > 0) {
      onHydrationRequested?.(fileId);
    }
  }

  function getHydrationFileId(event: MouseEvent): string | undefined {
    let sawTrigger = false;

    for (const entry of event.composedPath()) {
      if (!(entry instanceof Element)) {
        continue;
      }

      if (
        entry.matches('[data-unmodified-lines], [data-separator-content]')
      ) {
        sawTrigger = true;
      }

      if (entry.tagName.toLowerCase() === 'diffs-container') {
        return sawTrigger
          ? (entry.getAttribute('data-file-id') ?? undefined)
          : undefined;
      }
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return undefined;
    }

    const trigger = target.closest(
      '[data-unmodified-lines], [data-separator-content]'
    );
    if (trigger == null) {
      return undefined;
    }

    return (
      trigger.closest('diffs-container')?.getAttribute('data-file-id') ??
      undefined
    );
  }

  function createHydratedTextFile(
    file: ReviewDiffVirtualFile,
    patch: string,
    oldText: string,
    newText: string
  ): ReviewDiffTextFile {
    return {
      id: file.id,
      kind: 'text',
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      group: file.group,
      oldText,
      newText,
      byteSize: newText.length,
      lineCount: countLines(newText),
      patch,
    };
  }

  function createLoadedItemMap(
    nextItems: readonly CodeViewItem<ReviewDiffCommentMetadata>[]
  ): Map<string, CodeViewItem<ReviewDiffCommentMetadata>> {
    return new Map(nextItems.map((item) => [item.id, item]));
  }

  function mergeUnsafeCSS(baseCSS: string, extraCSS: string | undefined): string {
    return extraCSS == null || extraCSS.length === 0
      ? baseCSS
      : `${baseCSS}\n${extraCSS}`;
  }

  function getStateReasonLabel(
    file: ReviewDiffStateFile,
    currentLabels: ResolvedReviewDiffLabels
  ): string {
    switch (file.reason) {
      case 'binary_file':
        return currentLabels.binaryFile;
      case 'symlink_file':
        return currentLabels.symlinkFile;
      case 'invalid_text_encoding':
        return currentLabels.invalidTextEncoding;
      case 'read_error':
        return currentLabels.readError;
    }
  }

  function countLines(text: string): number {
    if (text.length === 0) {
      return 0;
    }

    return text.endsWith('\n')
      ? text.slice(0, -1).split('\n').length
      : text.split('\n').length;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<div
  bind:this={host}
  class={classValue}
  data-review-diff-code-view
  data-pierre-review-diff
  data-scrollbar="content"
  role="region"
  aria-label={resolvedLabels.ariaLabel}
  onclick={handleHydrationClick}
></div>

<style>
  :global(.pierre-review-diff) {
    display: block;
    min-height: 0;
    overflow: auto;
  }

  :global(.pierre-review-diff__collapse-button) {
    display: inline-grid;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 4px;
    color: inherit;
    background: transparent;
    font: inherit;
    line-height: 1;
    cursor: pointer;
  }

  :global(.pierre-review-diff__collapse-button:hover) {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }

  :global(.pierre-review-diff__collapse-button:disabled) {
    opacity: 0.45;
    cursor: default;
  }

  :global(.pierre-review-diff__collapse-button:disabled:hover) {
    background: transparent;
  }

  :global(.pierre-review-diff__state-badge) {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    min-height: 1.25rem;
    padding: 0 0.5rem;
    border-radius: 4px;
    color: inherit;
    background: color-mix(in srgb, currentColor 8%, transparent);
    font-size: 0.8125rem;
    line-height: 1.25rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
