# Svelte ReviewDiff 评论线程设计

## 背景

当前 `@pierre/diffs` 底层已经支持行级 annotation 能力：`CodeView` / `FileDiff`
可以接收 `lineAnnotations`、通过 `renderAnnotation`
渲染行下方内容，并通过 gutter utility 触发行级交互。新近加入的
`@pierre/diffs/svelte/review` 高阶入口已经可以渲染 review
diff、处理 collapse、virtual file
hydration 和演示页面，但还没有面向代码审查评论的一等 API。

用户目标是支持评论能力，并在 `apps/svelte-review-demo`
中提供对应示例。这里采用业界代码审查产品的通用终态模型：行上承载的是评论线程（comment
thread / discussion），而不是单条 flat
comment。组件负责锚定和触发新增请求；调用方负责线程状态、草稿、保存、删除、resolve/outdated、权限和持久化。

## 目标

- 为 `@pierre/diffs/svelte/review` 增加受控的行级评论线程 API。
- 让 `ReviewDiff` 使用现有 `CodeView` annotation 和 gutter
  utility 能力实现评论锚定，不新增第二套 diff 渲染系统。
- 在 `apps/svelte-review-demo` 中展示标准代码审查评论流程：点击 gutter
  “+” 创建草稿线程、保存、取消、删除。
- 保持现有 `ReviewDiff` 调用方不传评论相关 props 时行为不变。

## 非目标

- 不实现后端持久化、权限、通知、resolve/outdated 判定或提交位置重映射。
- 不支持文件级评论、二进制图片标注或不可读文件评论；这些需要独立模型。
- 不内置评论表单、头像、菜单、i18n 或业务 UI。
- 不把底层 `CodeView` 的所有 annotation 能力包装成通用 API；本次只做 review
  comment threads。

## 业界最佳实践结论

GitHub、GitLab、Bitbucket、Gerrit 等代码审查产品通常把 diff 行评论建模为“线程”：一个锚点对应一个 discussion/thread，线程内部可包含一条或多条回复，也可以有草稿、已解决、过期等业务状态。前端 diff 组件的稳定边界是：

- 锚定到当前 diff 的 `file + side + line`。
- 提供新增入口，通常是行号 gutter 的 “+”。
- 由上层应用控制线程数组和线程 UI。
- 对二进制、读取错误、不可渲染文件不提供行级评论。

因此，本次 API 使用受控 `commentThreads`，并由调用方通过 `renderCommentThread`
自定义线程内容。

## 公共 API

`@pierre/diffs/svelte/review` 新增公共类型和 props：

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

export interface ReviewDiffCommentThreadRenderContext<TMetadata = unknown> {
  file: ReviewDiffFile;
  target: ReviewDiffCommentTarget;
  thread: ReviewDiffCommentThread<TMetadata>;
}

export interface ReviewDiffCommentAddContext {
  file: ReviewDiffFile;
  target: ReviewDiffCommentTarget;
}
```

`ReviewDiffProps` 增加：

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
  codeViewOptions?: Partial<CodeViewOptions<undefined>>;

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

组件保持完全受控。`ReviewDiff` 不会修改
`commentThreads`；调用方在新增草稿、保存、取消、删除、resolve 或标记 outdated 时，以不可变方式更新数组。至少需要替换
`commentThreads` 数组引用；替换发生变化的 thread 对象是推荐做法。

## 支持范围

行级评论只支持可渲染 diff 文件：

- `ReviewDiffTextFile`
- `ReviewDiffVirtualFile`
- `ReviewDiffConflictFile`

`ReviewDiffStateFile`（binary、symlink、invalid encoding、read
error）不显示 gutter “+”，也不会渲染行级评论线程。

`virtual` 文件可以评论，因为 partial
patch 已经带有可见 diff 行号。调用方仍然负责决定真实业务里是否允许未 hydrate 的 virtual
diff 被评论。

## 组件行为

### 线程渲染

`ReviewDiff` 将 `commentThreads` 按 `target.fileId` 归组，并在创建每个 diff
item 时转换为底层 `DiffLineAnnotation`：

```ts
{
  side: thread.target.side,
  lineNumber: thread.target.lineNumber,
  metadata: { thread, target, file }
}
```

底层 `CodeView` 调用 `renderAnnotation` 时，`ReviewDiff` 调用
`renderCommentThread(thread, context)`。返回 `undefined`
表示调用方选择不渲染该线程。

### 新增入口

当存在 `onCommentThreadAddRequested` 时，`ReviewDiff` 为可评论文件启用
`enableGutterUtility` 和 `onGutterUtilityClick`。点击 gutter
“+” 后，组件从底层 range 归一化为单行 target：

```ts
const side = range.endSide ?? range.side;
const lineNumber = range.end;
```

如果 `side` 不存在，或者文件不可评论，则忽略。否则触发：

```ts
onCommentThreadAddRequested(target, { file, target });
```

如果没有
`onCommentThreadAddRequested`，组件不启用评论 gutter 入口，避免出现不可操作的 UI。

### 受控更新

`commentThreads`
是受控输入。调用方必须通过新的数组引用更新状态；原地 mutate 当前数组不保证触发渲染更新。`ReviewDiff`
在 `commentThreads` 引用变化时应确保对应 `CodeViewItem.version`
变化，让已有线程内容可以重新渲染。

## 与 `codeViewOptions` 的关系

`ReviewDiff` 是高阶 review 入口，评论线程是它的一等能力。因此启用评论 API 时：

- `ReviewDiff` 接管底层 `renderAnnotation`，用于渲染 comment threads。
- `ReviewDiff` 接管底层 `onGutterUtilityClick`，用于触发新增线程。
- 其他 `codeViewOptions` 继续透传，例如 theme、line
  wrapping、diffStyle 相关设置。

如果未来需要同时支持业务自定义 annotation 和评论线程，应新增独立扩展点，而不是让调用方直接混用底层
`renderAnnotation`。

## 错误处理

- thread 指向不存在的 `fileId`：忽略。
- thread 指向 `state` 文件：忽略。
- thread 指向当前 patch 不可见或不存在的行：底层 annotation 不会显示，组件不抛错。
- `renderCommentThread` 返回 `undefined`：不渲染该线程，其他线程继续渲染。
- 缺少 `renderCommentThread`：`commentThreads` 不渲染，但新增入口仍可按
  `onCommentThreadAddRequested` 配置触发；Demo 会同时提供两者。

## Demo 设计

`apps/svelte-review-demo` 新增受控评论线程示例：

- 初始包含 1-2 个 saved thread，分别锚定在新增行和删除行。
- toolbar 显示线程数量，并提供清空评论按钮。
- 点击 gutter “+” 后，Demo state 新增一个 draft thread。
- 同一行已有 draft thread 时复用或替换，避免堆叠多个空草稿。
- `renderCommentThread` 根据 metadata 渲染：
  - saved thread：作者、行信息、正文、删除按钮。
  - draft thread：textarea、Cancel、Save comment。
- 保存、取消、删除都只更新 Demo 的 `commentThreads` state，证明库 API 完全受控。
- binary/state 文件不会出现评论入口。

Demo metadata 可以是：

```ts
type DemoThreadMetadata =
  | {
      kind: 'saved';
      author: string;
      body: string;
      createdAtLabel: string;
    }
  | {
      kind: 'draft';
      body: string;
    };
```

## 测试计划

### `packages/diffs/test/ReviewDiff.fileItems.test.ts`

- `commentThreads` 转换为对应 diff item 的 annotations。
- 指向不存在 file 和 state file 的 thread 被忽略。
- thread 输入变化会改变 item version，确保受控更新能触发底层重渲染。

### `packages/diffs/test/ReviewDiff.svelte.test.ts`

- 传入 `commentThreads + renderCommentThread` 后能渲染线程内容。
- 点击 gutter add 后触发 `onCommentThreadAddRequested`，target 包含
  `fileId`、`side`、`lineNumber`。
- 未传 add handler 时不启用 gutter utility。

### `apps/svelte-review-demo/test/reviewComments.test.ts`

- 创建 draft thread。
- 保存 draft thread。
- 取消 / 删除 thread。
- 同一行 draft 去重。

## 验证命令

实现完成后运行：

```bash
bun run format
bun run lint
cd packages/diffs && bun test
cd packages/diffs && bun run tsc
cd apps/svelte-review-demo && bun test
cd apps/svelte-review-demo && bun run tsc
cd apps/svelte-review-demo && bun run build
```

如涉及根构建入口，也可运行 `bun run demo:build` 或新增对应 root script 后运行。
