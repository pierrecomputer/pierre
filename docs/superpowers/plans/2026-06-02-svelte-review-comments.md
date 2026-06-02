# Svelte ReviewDiff 评论线程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `@pierre/diffs/svelte/review`
增加受控的行级评论线程 API，并在 Svelte review demo 中展示标准代码审查评论流程。

**Architecture:** `ReviewDiff` 继续使用现有 `CodeView`、annotation
slot 和 gutter utility，不新增 diff 渲染系统。评论线程是完全受控输入：库只把
`commentThreads` 转成行级 annotations，并把 gutter “+” 点击归一化成
`fileId + side + lineNumber` 事件；Demo 负责草稿、保存、删除和线程 UI。

**Tech Stack:** Bun、TypeScript、Svelte 5、`@pierre/diffs` `CodeView`、Bun
test、jsdom、Vite。

---

## 执行约束

- 每个终端命令前先执行 `export AGENT=1`。
- 只使用 `bun`，不要使用 `npm`、`pnpm`、`npx`。
- 按 TDD 顺序执行：先写失败测试，再实现，再运行对应测试。
- 每个任务完成后运行该任务列出的最小验证命令。
- 修改代码后从 monorepo root 运行 `bun run format`。

## 文件结构

- Modify: `packages/diffs/src/svelte/review/types.d.ts`  
  增加评论线程公共类型，让 `ReviewDiffProps`、`CreateReviewDiffItemsOptions` 和
  `ReviewDiffItem` 使用评论 annotation metadata 泛型。
- Modify: `packages/diffs/src/svelte/review/index.d.ts`  
  保持声明入口导出新类型，并把组件声明改成 `ReviewDiffProps<unknown>`。
- Create: `packages/diffs/src/svelte/review/commentThreads.ts`  
  放置评论线程运行时 helper：判断文件是否可评论、把 threads 转 annotations、给 threads 数组分配引用版本。
- Modify: `packages/diffs/src/svelte/review/fileItems.ts`  
  在创建 diff item 时挂载评论 annotations，并把评论线程版本计入 item version。
- Modify: `packages/diffs/src/svelte/review/ReviewDiff.svelte`  
  接收 `commentThreads`、`renderCommentThread`、`onCommentThreadAddRequested`，把评论渲染和 gutter
  add 接入 `CodeView`。
- Modify: `packages/diffs/test/ReviewDiff.fileItems.test.ts`  
  覆盖评论线程到 annotations 的转换、忽略不可评论目标、版本更新。
- Modify: `packages/diffs/test/ReviewDiff.svelte.test.ts`  
  覆盖评论线程渲染和 gutter add 事件。
- Create: `apps/svelte-review-demo/src/reviewComments.ts`  
  Demo 受控评论线程状态 helper。
- Modify: `apps/svelte-review-demo/src/App.svelte`  
  使用评论线程 API，渲染 saved thread 和 draft thread。
- Modify: `apps/svelte-review-demo/src/style.css`  
  增加评论线程和草稿表单样式。
- Create: `apps/svelte-review-demo/test/reviewComments.test.ts`  
  覆盖 Demo 评论 helper。

---

### Task 1: Core comment thread item conversion

**Files:**

- Modify: `packages/diffs/test/ReviewDiff.fileItems.test.ts`
- Modify: `packages/diffs/src/svelte/review/types.d.ts`
- Modify: `packages/diffs/src/svelte/review/index.d.ts`
- Create: `packages/diffs/src/svelte/review/commentThreads.ts`
- Modify: `packages/diffs/src/svelte/review/fileItems.ts`

- [ ] **Step 1: 写失败测试：comment threads 转成 diff annotations**

在 `packages/diffs/test/ReviewDiff.fileItems.test.ts` 的
`describe('createReviewDiffItems', () => {` 内追加这个 test：

```ts
test('attaches comment threads to commentable diff items', () => {
  const file = createTextReviewFile('src/app.ts', 'commented');
  const thread = {
    id: 'thread-1',
    target: {
      fileId: 'src/app.ts',
      side: 'additions' as const,
      lineNumber: 1,
    },
    metadata: { body: 'Looks good from the review thread.' },
  };

  const [item] = createReviewDiffItems({
    files: [file],
    commentThreads: [thread],
  });

  expect(item?.type).toBe('diff');
  if (item?.type !== 'diff') {
    throw new Error('expected diff item');
  }

  expect(item.annotations).toHaveLength(1);
  expect(item.annotations?.[0]?.side).toBe('additions');
  expect(item.annotations?.[0]?.lineNumber).toBe(1);
  expect(item.annotations?.[0]?.metadata.thread).toBe(thread);
  expect(item.annotations?.[0]?.metadata.target).toEqual(thread.target);
  expect(item.annotations?.[0]?.metadata.file.id).toBe('src/app.ts');
});
```

- [ ] **Step 2: 写失败测试：忽略 missing file 和 state file**

继续在同一个 `describe` 内追加：

```ts
test('ignores comment threads for missing files and state files', () => {
  const textFile = createTextReviewFile('src/app.ts', 'commented');
  const stateFile: ReviewDiffFile = {
    id: 'assets/logo.png',
    kind: 'state',
    path: 'assets/logo.png',
    oldPath: null,
    status: 'binary',
    group: 'staged',
    reason: 'binary_file',
    byteSize: 256,
    message: null,
  };

  const items = createReviewDiffItems({
    files: [textFile, stateFile],
    commentThreads: [
      {
        id: 'missing-thread',
        target: {
          fileId: 'src/missing.ts',
          side: 'additions',
          lineNumber: 1,
        },
        metadata: { body: 'This file is not in the review.' },
      },
      {
        id: 'state-thread',
        target: {
          fileId: 'assets/logo.png',
          side: 'additions',
          lineNumber: 1,
        },
        metadata: { body: 'Binary files do not have line comments.' },
      },
    ],
  });

  const textItem = items.find((item) => item.id === 'src/app.ts');
  const stateItem = items.find((item) => item.id === 'assets/logo.png');

  expect(textItem?.type).toBe('diff');
  expect(
    textItem?.type === 'diff' ? textItem.annotations : undefined
  ).toBeUndefined();
  expect(stateItem?.type).toBe('diff');
  expect(
    stateItem?.type === 'diff' ? stateItem.annotations : undefined
  ).toBeUndefined();
});
```

- [ ] **Step 3: 写失败测试：comments array 引用变化会改变 item version**

继续在同一个 `describe` 内追加：

```ts
test('changes item versions when controlled comment thread arrays change', () => {
  const file = createTextReviewFile('src/app.ts', 'commented');
  const firstThreads = [
    {
      id: 'thread-1',
      target: {
        fileId: 'src/app.ts',
        side: 'additions' as const,
        lineNumber: 1,
      },
      metadata: { body: 'First body.' },
    },
  ];
  const secondThreads = [
    {
      id: 'thread-1',
      target: {
        fileId: 'src/app.ts',
        side: 'additions' as const,
        lineNumber: 1,
      },
      metadata: { body: 'Updated body.' },
    },
  ];

  const [firstItem] = createReviewDiffItems({
    files: [file],
    commentThreads: firstThreads,
  });
  const [secondItem] = createReviewDiffItems({
    files: [file],
    commentThreads: secondThreads,
  });

  expect(typeof firstItem?.version).toBe('number');
  expect(typeof secondItem?.version).toBe('number');
  expect(firstItem?.version).not.toBe(secondItem?.version);
});
```

- [ ] **Step 4: 运行失败测试**

Run:

```bash
export AGENT=1
cd packages/diffs && bun test test/ReviewDiff.fileItems.test.ts
```

Expected: FAIL because `commentThreads` is not a known
`CreateReviewDiffItemsOptions` property.

- [ ] **Step 5: 更新公共类型声明**

在 `packages/diffs/src/svelte/review/types.d.ts`
中，保留现有 imports 不变。然后在 `export type ReviewDiffFile` union
block 结束后添加：

```ts
export type ReviewDiffCommentSide = 'additions' | 'deletions';

export interface ReviewDiffCommentTarget {
  fileId: string;
  side: ReviewDiffCommentSide;
  lineNumber: number;
}

export interface ReviewDiffCommentThread<TMetadata = unknown> {
  /** Stable unique id for this thread within the review diff. */
  id: string;
  target: ReviewDiffCommentTarget;
  metadata: TMetadata;
}

export type ReviewDiffCommentableFile = Exclude<
  ReviewDiffFile,
  ReviewDiffStateFile
>;

export interface ReviewDiffCommentAnnotationMetadata<TMetadata = unknown> {
  file: ReviewDiffCommentableFile;
  target: ReviewDiffCommentTarget;
  thread: ReviewDiffCommentThread<TMetadata>;
}

export interface ReviewDiffCommentThreadRenderContext<TMetadata = unknown> {
  file: ReviewDiffCommentableFile;
  target: ReviewDiffCommentTarget;
  thread: ReviewDiffCommentThread<TMetadata>;
}

export interface ReviewDiffCommentAddContext {
  file: ReviewDiffCommentableFile;
  target: ReviewDiffCommentTarget;
}
```

Replace the current `ReviewDiffProps` interface with:

```ts
export interface ReviewDiffProps<TCommentMetadata = unknown> {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  wrap?: boolean;
  collapsed?: boolean;
  diffStyle?: 'split' | 'unified';
  labels?: ReviewDiffLabels;
  onHydrationRequested?: (fileId: string) => void;
  class?: string;
  codeViewOptions?: Partial<
    CodeViewOptions<ReviewDiffCommentAnnotationMetadata<TCommentMetadata>>
  >;
  commentThreads?: readonly ReviewDiffCommentThread<TCommentMetadata>[];
  renderCommentThread?: (
    thread: ReviewDiffCommentThread<TCommentMetadata>,
    context: ReviewDiffCommentThreadRenderContext<TCommentMetadata>
  ) => HTMLElement | undefined;
  onCommentThreadAddRequested?: (
    target: ReviewDiffCommentTarget,
    context: ReviewDiffCommentAddContext
  ) => void;
}
```

Replace `CreateReviewDiffItemsOptions` and `ReviewDiffItem` with:

```ts
export interface CreateReviewDiffItemsOptions<TCommentMetadata = unknown> {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  collapsed?: boolean;
  labels?: ReviewDiffLabels | ResolvedReviewDiffLabels;
  commentThreads?: readonly ReviewDiffCommentThread<TCommentMetadata>[];
}

export type ReviewDiffItem<TCommentMetadata = unknown> = CodeViewItem<
  ReviewDiffCommentAnnotationMetadata<TCommentMetadata>
>;
```

In `packages/diffs/src/svelte/review/index.d.ts`, replace:

```ts
declare const ReviewDiff: Component<ReviewDiffProps, ReviewDiffHandle>;
```

with:

```ts
declare const ReviewDiff: Component<ReviewDiffProps<unknown>, ReviewDiffHandle>;
```

- [ ] **Step 6: 创建评论线程 helper**

Create `packages/diffs/src/svelte/review/commentThreads.ts` with:

```ts
import type { DiffLineAnnotation } from '../../types.js';
import type {
  ReviewDiffCommentAnnotationMetadata,
  ReviewDiffCommentThread,
  ReviewDiffCommentableFile,
  ReviewDiffFile,
} from './types.js';

let nextCommentThreadsVersion = 1;
const commentThreadsVersions = new WeakMap<
  readonly ReviewDiffCommentThread<unknown>[],
  number
>();

export function isReviewDiffCommentableFile(
  file: ReviewDiffFile
): file is ReviewDiffCommentableFile {
  return file.kind !== 'state';
}

export function createReviewDiffCommentAnnotations<TMetadata>(
  file: ReviewDiffCommentableFile,
  commentThreads: readonly ReviewDiffCommentThread<TMetadata>[] | undefined
):
  | DiffLineAnnotation<ReviewDiffCommentAnnotationMetadata<TMetadata>>[]
  | undefined {
  if (commentThreads == null || commentThreads.length === 0) {
    return undefined;
  }

  const annotations: DiffLineAnnotation<
    ReviewDiffCommentAnnotationMetadata<TMetadata>
  >[] = [];

  for (const thread of commentThreads) {
    if (thread.target.fileId !== file.id) {
      continue;
    }

    annotations.push({
      side: thread.target.side,
      lineNumber: thread.target.lineNumber,
      metadata: {
        file,
        target: thread.target,
        thread,
      },
    });
  }

  return annotations.length === 0 ? undefined : annotations;
}

export function getReviewDiffCommentThreadsVersion(
  commentThreads: readonly ReviewDiffCommentThread<unknown>[] | undefined
): string {
  if (commentThreads == null || commentThreads.length === 0) {
    return '';
  }

  const existingVersion = commentThreadsVersions.get(commentThreads);
  if (existingVersion != null) {
    return existingVersion.toString(36);
  }

  const version = nextCommentThreadsVersion++;
  commentThreadsVersions.set(commentThreads, version);
  return version.toString(36);
}
```

- [ ] **Step 7: Wire comment annotations into file item creation**

In `packages/diffs/src/svelte/review/fileItems.ts`, add imports:

```ts
import {
  createReviewDiffCommentAnnotations,
  getReviewDiffCommentThreadsVersion,
  isReviewDiffCommentableFile,
} from './commentThreads.js';
```

Update the type imports to include:

```ts
  ReviewDiffCommentAnnotationMetadata,
  ReviewDiffCommentThread,
  ReviewDiffCommentableFile,
```

Change the function signature:

```ts
export function createReviewDiffItems<TCommentMetadata = unknown>({
  files,
  notices = [],
  collapsed = false,
  labels: unresolvedLabels,
  commentThreads,
}: CreateReviewDiffItemsOptions<TCommentMetadata>): ReviewDiffItem<TCommentMetadata>[] {
```

Immediately after `const itemIds = new Set(files.map((file) => file.id));`, add:

```ts
const commentableFileIds = new Set(
  files.filter(isReviewDiffCommentableFile).map((file) => file.id)
);
const validCommentThreads = commentThreads?.filter((thread) =>
  commentableFileIds.has(thread.target.fileId)
);
const commentThreadsVersion =
  getReviewDiffCommentThreadsVersion(validCommentThreads);
```

Change the file loop from:

```ts
for (const file of files) {
  items.push(createFileItem(file, collapsed, labels));
}
```

To:

```ts
for (const file of files) {
  items.push(
    createFileItem(
      file,
      collapsed,
      labels,
      validCommentThreads,
      commentThreadsVersion
    )
  );
}
```

Update `createFileItem` signature and branches:

```ts
function createFileItem<TCommentMetadata>(
  file: ReviewDiffFile,
  collapsed: boolean,
  labels: ResolvedReviewDiffLabels,
  commentThreads:
    | readonly ReviewDiffCommentThread<TCommentMetadata>[]
    | undefined,
  commentThreadsVersion: string
): ReviewDiffItem<TCommentMetadata> {
  switch (file.kind) {
    case 'text':
      return createTextItem(
        file,
        collapsed,
        commentThreads,
        commentThreadsVersion
      );
    case 'virtual':
      return createVirtualItem(
        file,
        collapsed,
        labels,
        commentThreads,
        commentThreadsVersion
      );
    case 'state':
      return createStateItem(file, collapsed, labels);
    case 'conflict':
      return createConflictItem(
        file,
        collapsed,
        commentThreads,
        commentThreadsVersion
      );
  }
}
```

Update `createTextItem`, `createVirtualItem`, and `createConflictItem` to accept
comment inputs and include annotations. For `createTextItem`, use this body
pattern:

```ts
function createTextItem<TCommentMetadata>(
  file: ReviewDiffTextFile,
  collapsed: boolean,
  commentThreads:
    | readonly ReviewDiffCommentThread<TCommentMetadata>[]
    | undefined,
  commentThreadsVersion: string
): ReviewDiffItem<TCommentMetadata> {
  const oldFile = createFileContents(
    file.oldPath ?? file.path,
    file.oldText,
    fingerprintString(file.id, 'old', file.oldPath ?? file.path, file.oldText)
  );
  const newFile = createFileContents(
    file.path,
    file.newText,
    fingerprintString(file.id, 'new', file.path, file.newText)
  );
  const annotations = createReviewDiffCommentAnnotations(file, commentThreads);

  return {
    id: file.id,
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
    annotations,
    version: fingerprint(
      file.kind,
      file.id,
      file.path,
      file.oldPath ?? '',
      file.status,
      file.oldText,
      file.newText,
      commentThreadsVersion
    ),
    collapsed,
  };
}
```

For `createVirtualItem`, add `annotations` to the successful return object and
include `commentThreadsVersion` in the version fingerprint. For
`createConflictItem`, add `annotations` to the return object and include
`commentThreadsVersion` in the version fingerprint. Leave `createStateItem`
unchanged so state files never receive annotations.

- [ ] **Step 8: Run focused tests**

Run:

```bash
export AGENT=1
cd packages/diffs && bun test test/ReviewDiff.fileItems.test.ts
```

Expected: PASS for all `ReviewDiff.fileItems` tests.

- [ ] **Step 9: Commit core conversion**

Run:

```bash
export AGENT=1
git add packages/diffs/src/svelte/review/types.d.ts packages/diffs/src/svelte/review/index.d.ts packages/diffs/src/svelte/review/commentThreads.ts packages/diffs/src/svelte/review/fileItems.ts packages/diffs/test/ReviewDiff.fileItems.test.ts
git commit -m "feat: map review comment threads to annotations"
```

Expected: commit succeeds.

---

### Task 2: ReviewDiff Svelte component integration

**Files:**

- Modify: `packages/diffs/test/ReviewDiff.svelte.test.ts`
- Modify: `packages/diffs/src/svelte/review/ReviewDiff.svelte`

- [ ] **Step 1: 写失败测试：渲染 comment thread**

In `packages/diffs/test/ReviewDiff.svelte.test.ts`, add these imports to the
existing import from `../src/svelte/review/index`:

```ts
  type ReviewDiffCommentTarget,
  type ReviewDiffCommentThread,
```

Inside `describe('ReviewDiff.svelte', () => {`, add:

```ts
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
        const wrapper = document.createElement('article');
        wrapper.dataset.reviewCommentThread = currentThread.id;
        wrapper.textContent = `${context.file.id}:${context.target.side}:${currentThread.metadata.body}`;
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
```

- [ ] **Step 2: 写失败测试：gutter add 触发 target event**

Add this helper near the other helper functions in `ReviewDiff.svelte.test.ts`:

```ts
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
```

Update `installDom()` so `originalValues` includes:

```ts
    MouseEvent: Reflect.get(globalThis, 'MouseEvent'),
    PointerEvent: Reflect.get(globalThis, 'PointerEvent'),
```

Add this class inside `installDom()` before `let nextFrameId = 0;`:

```ts
class MockPointerEvent extends dom.window.MouseEvent {
  pointerId: number;
  pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      ...init,
    });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
  }
}
```

Update the `Object.assign(globalThis, {` assignment block with these two
properties:

```ts
    MouseEvent: dom.window.MouseEvent,
    PointerEvent: MockPointerEvent,
```

After the `Object.assign(globalThis, {` assignment block, add:

```ts
Object.assign(dom.window, { PointerEvent: MockPointerEvent });
```

Then add this test in the `describe` block:

```ts
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
    '[data-column-number="1"][data-line-type="addition"]'
  );
  dispatchPointer(additionNumber, 'pointerdown');
  const utilityButton = await waitForElement<HTMLButtonElement>(
    additionNumber,
    '[data-utility-button]'
  );
  dispatchPointer(utilityButton, 'pointerdown');
  dispatchPointer(utilityButton, 'pointerup');

  expect(requestedTargets).toEqual([
    {
      fileId: 'src/app.ts',
      side: 'additions',
      lineNumber: 1,
    },
  ]);
});
```

- [ ] **Step 3: 运行失败测试**

Run:

```bash
export AGENT=1
cd packages/diffs && bun test test/ReviewDiff.svelte.test.ts
```

Expected: FAIL because `ReviewDiff.svelte` does not accept or render
`commentThreads` yet.

- [ ] **Step 4: Update ReviewDiff.svelte generic CodeView types and props**

In `packages/diffs/src/svelte/review/ReviewDiff.svelte`, add imports:

```ts
import { isReviewDiffCommentableFile } from './commentThreads.js';
```

Extend the type imports from `./types.js` with:

```ts
    ReviewDiffCommentAnnotationMetadata,
    ReviewDiffCommentTarget,
```

Replace the props destructuring with:

```ts
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
  commentThreads = [],
  renderCommentThread,
  onCommentThreadAddRequested,
}: ReviewDiffProps<unknown> = $props();
```

Replace these state declarations:

```ts
let viewer = $state<CodeView<undefined> | undefined>(undefined);
let loadedItems = new Map<string, CodeViewItem<undefined>>();
```

with:

```ts
type ReviewDiffCommentMetadata = ReviewDiffCommentAnnotationMetadata<unknown>;

let viewer = $state<CodeView<ReviewDiffCommentMetadata> | undefined>(undefined);
let loadedItems = new Map<string, CodeViewItem<ReviewDiffCommentMetadata>>();
```

Change `items` derived to pass comments:

```ts
const items: CodeViewItem<ReviewDiffCommentMetadata>[] = $derived(
  createReviewDiffItems({
    files: resolvedFiles,
    notices,
    collapsed,
    labels: resolvedLabels,
    commentThreads,
  })
);
```

When constructing `CodeView`, replace `new CodeView<undefined>(` with:

```ts
    const nextViewer = new CodeView<ReviewDiffCommentMetadata>(
```

- [ ] **Step 5: Add comment rendering and gutter add handlers**

In `createCodeViewOptions()`, change the return type:

```ts
  function createCodeViewOptions(): CodeViewOptions<ReviewDiffCommentMetadata> {
```

Inside the returned object, after `renderHeaderMetadata,`, add:

```ts
      renderAnnotation:
        renderCommentThread == null ? undefined : renderCommentAnnotation,
      enableGutterUtility:
        onCommentThreadAddRequested == null
          ? codeViewOptions?.enableGutterUtility
          : true,
      onGutterUtilityClick:
        onCommentThreadAddRequested == null
          ? codeViewOptions?.onGutterUtilityClick
          : handleCommentThreadAddRequested,
```

Add these functions below `renderHeaderMetadata`:

```ts
function renderCommentAnnotation(
  annotation: import('../../types.js').DiffLineAnnotation<ReviewDiffCommentMetadata>
): HTMLElement | undefined {
  return renderCommentThread?.(annotation.metadata.thread, {
    file: annotation.metadata.file,
    target: annotation.metadata.target,
    thread: annotation.metadata.thread,
  });
}

function handleCommentThreadAddRequested(
  range: import('../../types.js').SelectedLineRange,
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
```

Update helper signatures that still mention `CodeViewItem<undefined>` to
`CodeViewItem<ReviewDiffCommentMetadata>`:

```ts
  function applyItems(
    nextItems: readonly CodeViewItem<ReviewDiffCommentMetadata>[]
  ): void {
```

```ts
  function createLoadedItemMap(
    nextItems: readonly CodeViewItem<ReviewDiffCommentMetadata>[]
  ): Map<string, CodeViewItem<ReviewDiffCommentMetadata>> {
```

- [ ] **Step 6: Run focused Svelte component tests**

Run:

```bash
export AGENT=1
cd packages/diffs && bun test test/ReviewDiff.svelte.test.ts
```

Expected: PASS for all `ReviewDiff.svelte` tests.

- [ ] **Step 7: Run package typecheck for comments integration**

Run:

```bash
export AGENT=1
cd packages/diffs && bun run tsc
```

Expected: PASS. If TypeScript rejects inline `import('../../types.js')`
references inside the Svelte file, import
`type DiffLineAnnotation, SelectedLineRange` at the top from `../../types.js`
and use those names directly.

- [ ] **Step 8: Commit Svelte integration**

Run:

```bash
export AGENT=1
git add packages/diffs/src/svelte/review/ReviewDiff.svelte packages/diffs/test/ReviewDiff.svelte.test.ts
git commit -m "feat: expose review comment thread interactions"
```

Expected: commit succeeds.

---

### Task 3: Demo comment state helpers

**Files:**

- Create: `apps/svelte-review-demo/src/reviewComments.ts`
- Create: `apps/svelte-review-demo/test/reviewComments.test.ts`

- [ ] **Step 1: 写失败测试 for Demo helpers**

Create `apps/svelte-review-demo/test/reviewComments.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';

import {
  addDraftReviewCommentThread,
  createInitialReviewCommentThreads,
  removeReviewCommentThread,
  saveDraftReviewCommentThread,
  updateDraftReviewCommentThreadBody,
} from '../src/reviewComments';

const target = {
  fileId: 'src/lib/project-tools/review/create-review-panel.ts',
  side: 'additions' as const,
  lineNumber: 6,
};

describe('review comment helpers', () => {
  test('creates stable initial saved review threads', () => {
    const threads = createInitialReviewCommentThreads(1);

    expect(threads).toHaveLength(2);
    expect(threads.every((thread) => thread.metadata.kind === 'saved')).toBe(
      true
    );
    expect(threads[0]?.target.fileId).toBe(
      'src/lib/project-tools/review/create-review-panel.ts'
    );
  });

  test('adds one draft per target and reuses an existing draft on the same line', () => {
    const initial = createInitialReviewCommentThreads(1);
    const withDraft = addDraftReviewCommentThread(initial, target);
    const deduped = addDraftReviewCommentThread(withDraft, target);

    expect(withDraft).toHaveLength(initial.length + 1);
    expect(deduped).toHaveLength(withDraft.length);
    expect(
      deduped.filter((thread) => thread.metadata.kind === 'draft')
    ).toHaveLength(1);
  });

  test('updates and saves draft thread body', () => {
    const withDraft = addDraftReviewCommentThread([], target);
    const draftId = withDraft[0]?.id;
    if (draftId == null) {
      throw new Error('expected draft id');
    }

    const edited = updateDraftReviewCommentThreadBody(
      withDraft,
      draftId,
      'Ship this review comment.'
    );
    const saved = saveDraftReviewCommentThread(edited, draftId);

    expect(saved[0]?.metadata.kind).toBe('saved');
    expect(saved[0]?.metadata.body).toBe('Ship this review comment.');
    expect(
      saved[0]?.metadata.kind === 'saved' ? saved[0].metadata.author : undefined
    ).toBe('You');
  });

  test('does not save blank draft comments', () => {
    const withDraft = addDraftReviewCommentThread([], target);
    const draftId = withDraft[0]?.id;
    if (draftId == null) {
      throw new Error('expected draft id');
    }

    const saved = saveDraftReviewCommentThread(withDraft, draftId);

    expect(saved[0]?.metadata.kind).toBe('draft');
  });

  test('removes threads by id', () => {
    const withDraft = addDraftReviewCommentThread([], target);
    const draftId = withDraft[0]?.id;
    if (draftId == null) {
      throw new Error('expected draft id');
    }

    expect(removeReviewCommentThread(withDraft, draftId)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing helper tests**

Run:

```bash
export AGENT=1
cd apps/svelte-review-demo && bun test test/reviewComments.test.ts
```

Expected: FAIL because `src/reviewComments.ts` does not exist.

- [ ] **Step 3: Implement Demo helper module**

Create `apps/svelte-review-demo/src/reviewComments.ts`:

```ts
import type {
  ReviewDiffCommentTarget,
  ReviewDiffCommentThread,
} from '@pierre/diffs/svelte/review';

export type ReviewDemoCommentThread =
  ReviewDiffCommentThread<ReviewDemoCommentThreadMetadata>;

export type ReviewDemoCommentThreadMetadata =
  | ReviewDemoSavedCommentThreadMetadata
  | ReviewDemoDraftCommentThreadMetadata;

export interface ReviewDemoSavedCommentThreadMetadata {
  kind: 'saved';
  author: string;
  body: string;
  createdAtLabel: string;
}

export interface ReviewDemoDraftCommentThreadMetadata {
  kind: 'draft';
  body: string;
}

const PRIMARY_FILE_ID = 'src/lib/project-tools/review/create-review-panel.ts';
const CONFLICT_FILE_ID =
  'src/lib/panel-kits/project-tools/review/review-options.ts';

let nextDraftId = 1;

export function createInitialReviewCommentThreads(
  seed: number
): ReviewDemoCommentThread[] {
  return [
    {
      id: `saved-refresh-${seed}`,
      target: {
        fileId: PRIMARY_FILE_ID,
        side: 'additions',
        lineNumber: 6,
      },
      metadata: {
        kind: 'saved',
        author: 'Avery',
        body: 'This refresh interval is now visible in the review thread demo.',
        createdAtLabel: '2m ago',
      },
    },
    {
      id: `saved-conflict-${seed}`,
      target: {
        fileId: CONFLICT_FILE_ID,
        side: 'additions',
        lineNumber: 4,
      },
      metadata: {
        kind: 'saved',
        author: 'Morgan',
        body: 'Conflict comments stay controlled by the consuming Svelte app.',
        createdAtLabel: 'just now',
      },
    },
  ];
}

export function addDraftReviewCommentThread(
  threads: readonly ReviewDemoCommentThread[],
  target: ReviewDiffCommentTarget
): ReviewDemoCommentThread[] {
  const existingDraft = threads.find(
    (thread) =>
      thread.metadata.kind === 'draft' &&
      isSameCommentTarget(thread.target, target)
  );

  if (existingDraft != null) {
    return threads.map((thread) =>
      thread.id === existingDraft.id
        ? {
            ...thread,
            target,
          }
        : thread
    );
  }

  return [
    ...threads,
    {
      id: `draft-${nextDraftId++}`,
      target,
      metadata: {
        kind: 'draft',
        body: '',
      },
    },
  ];
}

export function updateDraftReviewCommentThreadBody(
  threads: readonly ReviewDemoCommentThread[],
  threadId: string,
  body: string
): ReviewDemoCommentThread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId || thread.metadata.kind !== 'draft') {
      return thread;
    }

    return {
      ...thread,
      metadata: {
        kind: 'draft',
        body,
      },
    };
  });
}

export function saveDraftReviewCommentThread(
  threads: readonly ReviewDemoCommentThread[],
  threadId: string
): ReviewDemoCommentThread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId || thread.metadata.kind !== 'draft') {
      return thread;
    }

    const body = thread.metadata.body.trim();
    if (body.length === 0) {
      return thread;
    }

    return {
      ...thread,
      id: thread.id.replace(/^draft-/, 'saved-draft-'),
      metadata: {
        kind: 'saved',
        author: 'You',
        body,
        createdAtLabel: 'now',
      },
    };
  });
}

export function removeReviewCommentThread(
  threads: readonly ReviewDemoCommentThread[],
  threadId: string
): ReviewDemoCommentThread[] {
  return threads.filter((thread) => thread.id !== threadId);
}

export function formatReviewCommentTarget(
  target: ReviewDiffCommentTarget
): string {
  const side = target.side === 'additions' ? 'new' : 'old';
  return `${side} line ${target.lineNumber}`;
}

function isSameCommentTarget(
  targetA: ReviewDiffCommentTarget,
  targetB: ReviewDiffCommentTarget
): boolean {
  return (
    targetA.fileId === targetB.fileId &&
    targetA.side === targetB.side &&
    targetA.lineNumber === targetB.lineNumber
  );
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
export AGENT=1
cd apps/svelte-review-demo && bun test test/reviewComments.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Demo helper module**

Run:

```bash
export AGENT=1
git add apps/svelte-review-demo/src/reviewComments.ts apps/svelte-review-demo/test/reviewComments.test.ts
git commit -m "feat: add svelte review comment helpers"
```

Expected: commit succeeds.

---

### Task 4: Demo UI wiring

**Files:**

- Modify: `apps/svelte-review-demo/src/App.svelte`
- Modify: `apps/svelte-review-demo/src/style.css`
- Modify: `apps/svelte-review-demo/test/reviewFiles.test.ts`

- [ ] **Step 1: Extend existing Demo test to confirm initial comments stay
      anchored to files**

In `apps/svelte-review-demo/test/reviewFiles.test.ts`, extend the import from
`../src/reviewComments` by adding a new import block after existing imports:

```ts
import { createInitialReviewCommentThreads } from '../src/reviewComments';
```

Inside `describe('createReviewFiles', () => {`, add:

```ts
test('creates initial review comment threads for rendered demo files', () => {
  const files = createReviewFiles(2);
  const fileIds = new Set(files.map((file) => file.id));
  const threads = createInitialReviewCommentThreads(2);

  expect(threads).toHaveLength(2);
  expect(threads.every((thread) => fileIds.has(thread.target.fileId))).toBe(
    true
  );
});
```

- [ ] **Step 2: Run failing / focused Demo tests**

Run:

```bash
export AGENT=1
cd apps/svelte-review-demo && bun test
```

Expected: PASS if Task 3 is complete. This step protects the demo fixtures
before wiring the UI.

- [ ] **Step 3: Update App.svelte imports and state**

In `apps/svelte-review-demo/src/App.svelte`, update the imports from
`@pierre/diffs/svelte/review`:

```svelte
  import ReviewDiff, {
    type ReviewDiffCommentAddContext,
    type ReviewDiffCommentTarget,
    type ReviewDiffCommentThreadRenderContext,
    type ReviewDiffHandle,
    type ReviewDiffLabels,
  } from '@pierre/diffs/svelte/review';
```

Add helper imports below `createReviewFiles`:

```svelte
  import {
    addDraftReviewCommentThread,
    createInitialReviewCommentThreads,
    formatReviewCommentTarget,
    removeReviewCommentThread,
    saveDraftReviewCommentThread,
    updateDraftReviewCommentThreadBody,
    type ReviewDemoCommentThread,
  } from './reviewComments';
```

Add state after `let hydrationStatus = $state('Idle');`:

```svelte
  let commentThreads = $state<ReviewDemoCommentThread[]>(
    createInitialReviewCommentThreads(seed)
  );
```

Add this effect after derived `deletions`:

```svelte
  $effect(() => {
    commentThreads = commentThreads.filter((thread) =>
      filesById.has(thread.target.fileId)
    );
  });
```

- [ ] **Step 4: Add App.svelte comment event and renderer functions**

Add these functions before `hydrateFile`:

```svelte
  function requestCommentThread(
    target: ReviewDiffCommentTarget,
    _context: ReviewDiffCommentAddContext
  ): void {
    commentThreads = addDraftReviewCommentThread(commentThreads, target);
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

    const form = document.createElement('form');
    form.className = 'review-demo-comment review-demo-comment--draft';
    form.dataset.reviewCommentThread = thread.id;

    const label = document.createElement('label');
    label.className = 'review-demo-comment__label';
    label.textContent = `New comment on ${formatReviewCommentTarget(context.target)}`;

    const textarea = document.createElement('textarea');
    textarea.className = 'review-demo-comment__textarea';
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
```

- [ ] **Step 5: Update toolbar and ReviewDiff props**

In the toolbar, after the changed-lines stat
`<div class="review-demo__stat" aria-label="Changed lines">`, add:

```svelte
    <div class="review-demo__stat" aria-label="Review comment threads">
      {commentThreads.length} thread{commentThreads.length === 1 ? '' : 's'}
    </div>
    <button
      type="button"
      class="review-demo__icon-button"
      title="Reset demo comments"
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
```

In the existing Refresh button click handler, replace:

```svelte
        seed += 1;
        hydrationStatus = 'Refreshed';
```

with:

```svelte
        seed += 1;
        commentThreads = createInitialReviewCommentThreads(seed);
        hydrationStatus = 'Refreshed';
```

Add comment props to the existing `<ReviewDiff>` component invocation:

```svelte
      {commentThreads}
      renderCommentThread={renderCommentThread}
      onCommentThreadAddRequested={requestCommentThread}
```

- [ ] **Step 6: Add Demo comment styles**

Append to `apps/svelte-review-demo/src/style.css` before the media query:

```css
.review-demo-comment {
  box-sizing: border-box;
  max-width: min(40rem, 100%);
  margin: 8px 12px;
  border: 1px solid rgb(96 165 250 / 28%);
  border-radius: 8px;
  color: #dbeafe;
  background: #0b1220;
  box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.review-demo-comment__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 9px 10px;
  border-bottom: 1px solid rgb(96 165 250 / 16%);
  color: #bfdbfe;
  font-size: 12px;
}

.review-demo-comment__header span {
  color: #94a3b8;
}

.review-demo-comment__body {
  margin: 0;
  padding: 10px;
  color: #e5e7eb;
  font-size: 13px;
  line-height: 1.5;
}

.review-demo-comment__label {
  display: block;
  padding: 9px 10px 0;
  color: #bfdbfe;
  font-size: 12px;
  font-weight: 600;
}

.review-demo-comment__textarea {
  box-sizing: border-box;
  width: calc(100% - 20px);
  min-height: 72px;
  margin: 8px 10px 0;
  padding: 8px;
  border: 1px solid rgb(148 163 184 / 30%);
  border-radius: 6px;
  color: #e5e7eb;
  background: #111827;
  font: inherit;
  line-height: 1.4;
  resize: vertical;
}

.review-demo-comment__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px;
}

.review-demo-comment__ghost-button,
.review-demo-comment__primary-button {
  min-height: 28px;
  border-radius: 6px;
  padding: 0 10px;
  cursor: pointer;
}

.review-demo-comment__ghost-button {
  border: 1px solid rgb(148 163 184 / 28%);
  color: #d8dee9;
  background: rgb(24 27 34 / 86%);
}

.review-demo-comment__primary-button {
  border: 1px solid rgb(37 99 235 / 90%);
  color: #fff;
  background: #2563eb;
}
```

- [ ] **Step 7: Run Demo tests and typecheck**

Run:

```bash
export AGENT=1
cd apps/svelte-review-demo && bun test
cd apps/svelte-review-demo && bun run tsc
```

Expected: both PASS.

- [ ] **Step 8: Commit Demo UI**

Run:

```bash
export AGENT=1
git add apps/svelte-review-demo/src/App.svelte apps/svelte-review-demo/src/style.css apps/svelte-review-demo/src/reviewComments.ts apps/svelte-review-demo/test/reviewComments.test.ts apps/svelte-review-demo/test/reviewFiles.test.ts
git commit -m "feat: demo controlled review comment threads"
```

Expected: commit succeeds.

---

### Task 5: Final verification and cleanup

**Files:**

- Review: all changed files

- [ ] **Step 1: Run root format**

Run:

```bash
export AGENT=1
bun run format
```

Expected: command exits 0.

- [ ] **Step 2: Run package tests**

Run:

```bash
export AGENT=1
cd packages/diffs && bun test
cd apps/svelte-review-demo && bun test
```

Expected: both commands exit 0.

- [ ] **Step 3: Run typechecks**

Run:

```bash
export AGENT=1
cd packages/diffs && bun run tsc
cd apps/svelte-review-demo && bun run tsc
```

Expected: both commands exit 0.

- [ ] **Step 4: Run root lint**

Run:

```bash
export AGENT=1
bun run lint
```

Expected: command exits 0.

- [ ] **Step 5: Run Svelte review demo build**

Run:

```bash
export AGENT=1
cd apps/svelte-review-demo && bun run build
```

Expected: Vite build exits 0 and writes `apps/svelte-review-demo/dist`.

- [ ] **Step 6: Inspect final diff**

Run:

```bash
export AGENT=1
git status --short
git diff --stat HEAD
```

Expected: working tree only contains intentional changes from this plan, or is
clean if each task committed.

- [ ] **Step 7: Final commit if earlier tasks were not committed**

If tasks were executed without intermediate commits, run:

```bash
export AGENT=1
git add packages/diffs/src/svelte/review/types.d.ts packages/diffs/src/svelte/review/index.d.ts packages/diffs/src/svelte/review/commentThreads.ts packages/diffs/src/svelte/review/fileItems.ts packages/diffs/src/svelte/review/ReviewDiff.svelte packages/diffs/test/ReviewDiff.fileItems.test.ts packages/diffs/test/ReviewDiff.svelte.test.ts apps/svelte-review-demo/src/reviewComments.ts apps/svelte-review-demo/src/App.svelte apps/svelte-review-demo/src/style.css apps/svelte-review-demo/test/reviewComments.test.ts apps/svelte-review-demo/test/reviewFiles.test.ts
git commit -m "feat: add svelte review comment threads"
```

Expected: commit succeeds. If previous task commits already exist and
`git status --short` is clean, skip this step.

---

## Self-review

- Spec coverage: Task 1 adds public types and item conversion; Task 2 adds
  `ReviewDiff` rendering and gutter add API; Task 3 and Task 4 add the
  controlled Demo flow; Task 5 verifies format, tests, typecheck, lint, and
  build.
- Placeholder scan: The plan uses concrete file paths, concrete test code,
  implementation snippets, commands, and expected outcomes.
- Type consistency: Public names match the approved spec: `commentThreads`,
  `renderCommentThread`, `onCommentThreadAddRequested`,
  `ReviewDiffCommentTarget`, and `ReviewDiffCommentThread`.
