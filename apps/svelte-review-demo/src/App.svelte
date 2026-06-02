<script lang="ts">
  import ReviewDiff, {
    type ReviewDiffHandle,
    type ReviewDiffLabels,
  } from '@pierre/diffs/svelte/review';

  import { createReviewFiles } from './reviewFiles';

  let seed = $state(1);
  let wrap = $state(false);
  let collapsed = $state(false);
  let diffStyle: 'split' | 'unified' = $state('split');
  let reviewDiff: ReviewDiffHandle | undefined = $state();
  let hydrationStatus = $state('Idle');

  const files = $derived(createReviewFiles(seed));
  const filesById = $derived(new Map(files.map((file) => [file.id, file])));
  const additions = $derived(seed + 5);
  const deletions = $derived(2);

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
      onHydrationRequested={hydrateFile}
    />
  </section>
</main>
