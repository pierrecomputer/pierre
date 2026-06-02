<script lang="ts">
  import ReviewDiff, {
    type ReviewDiffCommentAddContext,
    type ReviewDiffCommentTarget,
    type ReviewDiffCommentThread,
    type ReviewDiffCommentThreadRenderContext,
    type ReviewDiffHandle,
    type ReviewDiffLabels,
  } from '@pierre/diffs/svelte/review';

  import {
    addDraftReviewCommentThread,
    createInitialReviewCommentThreads,
    formatReviewCommentTarget,
    removeReviewCommentThread,
    type ReviewDemoCommentThread,
    saveDraftReviewCommentThread,
    updateDraftReviewCommentThreadBody,
  } from './reviewComments';
  import { createReviewFiles } from './reviewFiles';

  const initialSeed = 1;

  let seed = $state(initialSeed);
  let wrap = $state(false);
  let collapsed = $state(false);
  let diffStyle: 'split' | 'unified' = $state('split');
  let reviewDiff: ReviewDiffHandle | undefined = $state();
  let hydrationStatus = $state('Idle');
  let commentThreads = $state<ReviewDemoCommentThread[]>(
    createInitialReviewCommentThreads(initialSeed)
  );

  const files = $derived(createReviewFiles(seed));
  const filesById = $derived(new Map(files.map((file) => [file.id, file])));
  const additions = $derived(seed + 5);
  const deletions = $derived(2);

  $effect(() => {
    const filteredCommentThreads = commentThreads.filter((thread) =>
      filesById.has(thread.target.fileId)
    );

    if (filteredCommentThreads.length !== commentThreads.length) {
      commentThreads = filteredCommentThreads;
    }
  });

  const labels: ReviewDiffLabels = {
    ariaLabel: 'Review diff',
    collapseFile: 'Collapse file',
    expandFile: 'Expand file',
    noticeTitle: 'Notice',
    binaryFile: 'Binary file',
    symlinkFile: 'Symbolic link',
    invalidTextEncoding: 'Invalid text encoding',
    readError: 'Unable to read file',
    formatUnmodifiedLines: (count) =>
      `${count} unchanged line${count === 1 ? '' : 's'}`,
  };

  function requestCommentThread(
    target: ReviewDiffCommentTarget,
    _context: ReviewDiffCommentAddContext
  ): void {
    commentThreads = addDraftReviewCommentThread(commentThreads, target);
  }

  // Narrows the component's unknown metadata type back to the demo thread type
  // passed through the controlled commentThreads prop.
  function renderReviewDiffCommentThread(
    thread: ReviewDiffCommentThread<unknown>,
    context: ReviewDiffCommentThreadRenderContext<unknown>
  ): HTMLElement | undefined {
    return renderCommentThread(
      thread as ReviewDemoCommentThread,
      context as ReviewDiffCommentThreadRenderContext<
        ReviewDemoCommentThread['metadata']
      >
    );
  }

  function renderCommentThread(
    thread: ReviewDemoCommentThread,
    context: ReviewDiffCommentThreadRenderContext<ReviewDemoCommentThread['metadata']>
  ): HTMLElement | undefined {
    if (thread.metadata.kind === 'draft') {
      return renderDraftCommentThread(thread, context);
    }

    return renderSavedCommentThread(thread, context);
  }

  function renderSavedCommentThread(
    thread: ReviewDemoCommentThread,
    context: ReviewDiffCommentThreadRenderContext<ReviewDemoCommentThread['metadata']>
  ): HTMLElement | undefined {
    if (thread.metadata.kind !== 'saved') {
      return undefined;
    }

    const wrapper = document.createElement('article');
    wrapper.className = 'review-demo-comment review-demo-comment--saved';
    wrapper.dataset.reviewCommentThread = thread.id;

    const header = document.createElement('div');
    header.className = 'review-demo-comment__header';

    const author = document.createElement('strong');
    author.textContent = thread.metadata.author;

    const targetLabel = document.createElement('span');
    targetLabel.textContent = `${formatReviewCommentTarget(context.target)} · ${thread.metadata.createdAtLabel}`;

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'review-demo-comment__ghost-button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => {
      commentThreads = removeReviewCommentThread(commentThreads, thread.id);
    });

    const body = document.createElement('p');
    body.className = 'review-demo-comment__body';
    body.textContent = thread.metadata.body;

    header.append(author, targetLabel, deleteButton);
    wrapper.append(header, body);
    return wrapper;
  }

  function renderDraftCommentThread(
    thread: ReviewDemoCommentThread,
    context: ReviewDiffCommentThreadRenderContext<ReviewDemoCommentThread['metadata']>
  ): HTMLElement | undefined {
    if (thread.metadata.kind !== 'draft') {
      return undefined;
    }

    const textareaId = `review-demo-comment-${thread.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    const form = document.createElement('form');
    form.className = 'review-demo-comment review-demo-comment--draft';
    form.dataset.reviewCommentThread = thread.id;

    const label = document.createElement('label');
    label.className = 'review-demo-comment__label';
    label.htmlFor = textareaId;
    label.textContent = `New comment on ${formatReviewCommentTarget(context.target)}`;

    const textarea = document.createElement('textarea');
    textarea.className = 'review-demo-comment__textarea';
    textarea.id = textareaId;
    textarea.value = thread.metadata.body;
    textarea.placeholder = 'Leave a comment…';
    textarea.rows = 3;
    textarea.spellcheck = true;
    textarea.addEventListener('input', () => {
      commentThreads = updateDraftReviewCommentThreadBody(
        commentThreads,
        thread.id,
        textarea.value
      );
    });

    const actions = document.createElement('div');
    actions.className = 'review-demo-comment__actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'review-demo-comment__ghost-button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      commentThreads = removeReviewCommentThread(commentThreads, thread.id);
    });

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'review-demo-comment__primary-button';
    save.textContent = 'Save comment';

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      commentThreads = saveDraftReviewCommentThread(commentThreads, thread.id);
    });

    actions.append(cancel, save);
    form.append(label, textarea, actions);
    window.setTimeout(() => textarea.focus(), 0);
    return form;
  }

  function hydrateFile(fileId: string): void {
    const file = filesById.get(fileId);
    if (file?.kind !== 'virtual') {
      return;
    }

    hydrationStatus = `Loading ${file.path}`;
    window.setTimeout(() => {
      reviewDiff?.hydrateFile(
        file.id,
        file.patch,
        createHydratedText('before', seed, file.lineCount),
        createHydratedText('after', seed, file.lineCount)
      );
      hydrationStatus = `Hydrated ${file.path}`;
    }, 180);
  }

  function createHydratedText(
    label: string,
    currentSeed: number,
    lineCount: number
  ): string {
    return Array.from(
      { length: Math.max(1, lineCount) },
      (_, index) =>
        `const ${label}Line${index + 1} = ${JSON.stringify(`demo-${currentSeed}-${index + 1}`)};`
    ).join('\n');
  }
</script>

<main class="review-demo">
  <header class="review-demo__toolbar" aria-label="Review controls">
    <div class="review-demo__scope">
      <button type="button" class="review-demo__scope-button" aria-pressed="true">
        Uncommitted
      </button>
      <button type="button" class="review-demo__scope-button">Committed</button>
      <button type="button" class="review-demo__scope-button">Branch</button>
    </div>

    <div class="review-demo__toolbar-spacer"></div>

    <div class="review-demo__stat" aria-label="Changed lines">
      <span class="review-demo__deletions">-{deletions}</span>
      <span class="review-demo__additions">+{additions}</span>
    </div>
    <div class="review-demo__stat" aria-label="Review comment threads">
      {commentThreads.length} thread{commentThreads.length === 1 ? '' : 's'}
    </div>
    <button
      type="button"
      class="review-demo__icon-button"
      title="Reset comments"
      onclick={() => {
        commentThreads = createInitialReviewCommentThreads(seed);
      }}
    >
      Reset comments
    </button>
    <button
      type="button"
      class="review-demo__icon-button"
      title="Clear comments"
      onclick={() => {
        commentThreads = [];
      }}
    >
      Clear comments
    </button>

    <button
      type="button"
      class="review-demo__icon-button"
      aria-pressed={wrap}
      title={wrap ? 'Disable line wrap' : 'Enable line wrap'}
      onclick={() => (wrap = !wrap)}
    >
      Wrap
    </button>
    <button
      type="button"
      class="review-demo__icon-button"
      title={diffStyle === 'split' ? 'Switch to unified diff' : 'Switch to split diff'}
      onclick={() => (diffStyle = diffStyle === 'split' ? 'unified' : 'split')}
    >
      {diffStyle === 'split' ? 'Split' : 'Unified'}
    </button>
    <button
      type="button"
      class="review-demo__icon-button"
      title="Collapse all"
      onclick={() => {
        collapsed = true;
        reviewDiff?.applyCollapseModeToLoaded(true);
      }}
    >
      Collapse
    </button>
    <button
      type="button"
      class="review-demo__icon-button"
      title="Expand all"
      onclick={() => {
        collapsed = false;
        reviewDiff?.applyCollapseModeToLoaded(false);
      }}
    >
      Expand
    </button>
    <button
      type="button"
      class="review-demo__icon-button"
      title="Refresh"
      onclick={() => {
        seed += 1;
        commentThreads = createInitialReviewCommentThreads(seed);
        hydrationStatus = 'Refreshed';
      }}
    >
      Refresh
    </button>
  </header>

  <section class="review-demo__body" data-review-diff-body>
    <div class="review-demo__refresh-state" role="status">
      {hydrationStatus}
    </div>
    <ReviewDiff
      bind:this={reviewDiff}
      class="review-demo__diff"
      {files}
      {wrap}
      {collapsed}
      {diffStyle}
      {labels}
      {commentThreads}
      renderCommentThread={renderReviewDiffCommentThread}
      onCommentThreadAddRequested={requestCommentThread}
      onHydrationRequested={hydrateFile}
    />
  </section>
</main>
