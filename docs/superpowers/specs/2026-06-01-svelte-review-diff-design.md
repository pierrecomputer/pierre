# Svelte 审查差异区域设计

## 背景

这个仓库是 `@pierre/diffs` 的维护分支，目标是把 `/Users/xyz/ABC/loomdesk` 中通过
`patches/@pierre%2Fdiffs@1.2.3.patch`
修补的能力正式回流到库里，并把 LoomDesk 现在手写的 Svelte 差异区域集成沉淀成可复用入口。

本次范围只覆盖审查面板里的差异区域，不覆盖 LoomDesk 的完整审查工具栏、提交选择、分支选择、Git 监听和 IPC 拉取逻辑。演示页面（Demo）需要展示可迁移的完整差异区域实现，后续 LoomDesk 应能用很薄的适配把当前
`GitDiffReviewFile[]` 交给库组件。

## 目标

- 在 `@pierre/diffs` 核心中正式补齐 LoomDesk 依赖的 patch 能力。
- 新增 `@pierre/diffs/svelte/review`
  高阶入口，导出完整的 Svelte 审查差异区域组件。
- 新增独立
  `apps/svelte-review-demo`，用模拟数据展示与 LoomDesk 差异区域一致的界面和交互。
- 保持库不绑定 LoomDesk 的 i18n、Electron、IPC 或业务状态管理。

## 非目标

- 不实现审查工具栏、范围切换、分支/提交选择器、自动 Git watch 或 IPC。
- 不把 LoomDesk 的 `m.*` 文案函数、`@runloom/ui`
  组件或 Electron 契约类型直接引入库。
- 不重写 `@pierre/diffs` 已有 React 和原生 DOM API。
- 不改变现有 `CodeView`、`FileDiff`
  等核心入口的默认行为，新增能力必须保持向后兼容。

## 核心库能力

### 未修改行文案格式化

`BaseDiffOptions` 新增：

```ts
formatUnmodifiedLines?: (lines: number) => string;
```

默认值保持现在的英文行为：

```ts
function getModifiedLinesString(lines: number) {
  return `${lines} unmodified line${lines > 1 ? 's' : ''}`;
}
```

该选项需要贯穿：

- `BaseDiffOptions` / `BaseDiffOptionsWithDefaults`
- `DiffHunksRendererOptions`
- `getDiffHunksRendererOptions`
- `DiffHunksRenderer.getOptionsWithDefaults`
- `CodeView` 的 diff 透传选项列表
- worker 渲染参数和 `worker-portable.js` 构建产物

`createSeparator` 继续只接收最终字符串，格式化逻辑留在渲染器层。

### `CodeView.updateItem` 滚动锚点

`CodeView.updateItem(input)` 在查找 item 之前调用
`capturePendingLayoutAnchor()`。这样同一 id 的内容原地更新时，虚拟列表可以按更新前可见项恢复滚动位置，避免 LoomDesk 自动刷新或 hydration 后视图跳动。

该行为只影响 `updateItem`，不改变 `setItems`、`addItems` 和 `updateItemId`
的语义。

### 窗口化渲染的分隔行边界

`iterateOverDiff` 在处理 `leadingRegion`
时记录分隔行应该归属的 split/unified 边界。当窗口从已展开区域中间开始渲染时，`collapsedBefore`
不应再附着到当前窗口第一行，避免重复出现“未修改行”分隔行。

该修复必须覆盖 `split`、`unified` 和 `both` 三种计数路径，但本次演示页面只展示
`split` 和 `unified`。

## Svelte 审查差异入口

### 导出路径

新增子路径：

```ts
import ReviewDiff from '@pierre/diffs/svelte/review';
import type {
  ReviewDiffFile,
  ReviewDiffLabels,
  ReviewDiffHandle,
} from '@pierre/diffs/svelte/review';
```

`packages/diffs/package.json` 增加：

```json
"./svelte/review": {
  "types": "./dist/svelte/review/index.d.ts",
  "svelte": "./dist/svelte/review/ReviewDiff.svelte",
  "import": "./dist/svelte/review/index.js"
}
```

如果构建工具对 `.svelte` 产物支持不足，计划中需要优先验证 tsdown 是否能复制
`.svelte` 文件；不通过时引入 `svelte-package` 或 Vite library
build，但仍保持对外子路径不变。

### 输入类型

库内定义去业务命名的 `ReviewDiffFile`，结构与 LoomDesk 当前 `GitDiffReviewFile`
保持同构：

```ts
export type ReviewDiffFileGroup =
  | 'unstaged'
  | 'staged'
  | 'committed'
  | 'branch'
  | (string & {});

export type ReviewDiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'conflicted'
  | 'binary';

interface ReviewDiffFileBase {
  id: string;
  path: string;
  oldPath: string | null;
  status: ReviewDiffFileStatus;
  group: ReviewDiffFileGroup;
}

export interface ReviewDiffTextFile extends ReviewDiffFileBase {
  kind: 'text';
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldText: string;
  newText: string;
  byteSize: number;
  lineCount: number;
  patch: string;
}

export interface ReviewDiffVirtualFile extends ReviewDiffFileBase {
  kind: 'virtual';
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
  byteSize: number;
  lineCount: number;
  contextLines: number;
  canExpandContext: boolean;
}

export interface ReviewDiffStateFile extends ReviewDiffFileBase {
  kind: 'state';
  reason:
    | 'binary_file'
    | 'symlink_file'
    | 'invalid_text_encoding'
    | 'read_error';
  byteSize: number | null;
  message: string | null;
}

export interface ReviewDiffConflictFile extends ReviewDiffFileBase {
  kind: 'conflict';
  status: 'conflicted';
  baseText: string | null;
  oursText: string | null;
  theirsText: string | null;
  worktreeText: string;
  patch: string;
  byteSize: number;
  lineCount: number;
}

export type ReviewDiffFile =
  | ReviewDiffTextFile
  | ReviewDiffVirtualFile
  | ReviewDiffStateFile
  | ReviewDiffConflictFile;
```

保留 `group` 的扩展字符串能力，避免库把调用方的 Git 分组枚举写死。

### 组件属性

```ts
export interface ReviewDiffLabels {
  ariaLabel?: string;
  collapseFile?: string;
  expandFile?: string;
  noticeTitle?: string;
  binaryFile?: string;
  symlinkFile?: string;
  invalidTextEncoding?: string;
  readError?: string;
  formatUnmodifiedLines?: (count: number) => string;
}

export interface ReviewDiffProps {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  wrap?: boolean;
  collapsed?: boolean;
  diffStyle?: 'split' | 'unified';
  labels?: ReviewDiffLabels;
  onHydrationRequested?: (fileId: string) => void;
  class?: string;
}
```

默认值：

- `notices = []`
- `wrap = false`
- `collapsed = false`
- `diffStyle = 'split'`
- `labels.formatUnmodifiedLines` 使用核心库默认英文文案

### 组件方法

组件通过 Svelte 实例方法暴露：

```ts
export interface ReviewDiffHandle {
  applyCollapseModeToLoaded(nextCollapsed: boolean): void;
  hydrateFile(
    fileId: string,
    patch: string,
    oldText: string,
    newText: string
  ): void;
}
```

LoomDesk 迁移后可以保持当前调用模式：

```svelte
<ReviewDiff bind:this={reviewDiff} files={result.files} labels={labels} />
```

### 内部行为

组件内部复用 LoomDesk 当前验证过的行为，但改成库级实现：

- 通过 `CodeView` 管理所有文件和 notice。
- `text` / `conflict` 文件优先用 `processFile(patch, { oldFile, newFile })`
  生成完整上下文 diff。
- `virtual` 文件先渲染 patch 里的局部内容，点击未修改行分隔区域时触发
  `onHydrationRequested(fileId)`。
- `hydrateFile` 接收调用方异步补回的全文后，用 `CodeView.updateItem`
  原地替换同 id diff。
- `state` 文件生成一条只读 diff 行，并在 header metadata slot 显示状态 badge。
- notices 渲染成 `type: 'file'` 的普通文件项，排在文件列表前。
- 同 id 且同顺序的内容变化走 `CodeView.updateItem`，保留滚动位置和其他文件状态。
- 文件集增删或重排走分批重建，并用可见 item 锚点恢复滚动。
- 大批量同序内容变化回退分批重建，避免主线程长时间同步处理。
- 外部 `collapsed` 变化只更新已加载项，不销毁整个 `CodeView`。
- 单文件 header prefix
  slot 渲染折叠按钮；黏性文件头区域点击折叠时保持当前文件锚点。
- locale 或 label 变化时，重置影响文案的渲染缓存，确保未修改行文案更新。

### worker 池

Svelte 入口内部提供引用计数 worker 池：

- 浏览器且存在 `Worker` 时创建。
- 默认使用 `@pierre/diffs/worker/worker-portable.js`，避免调用方自己写 worker
  factory。
- 创建失败或 `isWorkingPool()` 为 false 时退回主线程高亮，不抛错。
- 组件销毁时释放引用；最后一个实例销毁时终止池。
- 主题切换时调用 `setRenderOptions({ theme })` 同步 worker 高亮主题。

### 主题和样式

库组件不依赖 LoomDesk 的 `createAppStyleTokens`。它提供两层能力：

- 默认样式：足够接近 LoomDesk 差异区域的布局和交互，适用于演示页面。
- `unsafeCSS` 或 `theme` 的受控入口：调用方可以传入自己的 `CodeViewOptions`
  子集或 CSS 变量覆盖。

为了降低迁移成本，第一版组件内置 LoomDesk 当前差异区域所需的结构样式：

- 容器：`relative h-full min-h-80 min-w-0 flex-1 overflow-x-clip overflow-y-auto overscroll-contain rounded-lg border ...`
- `data-review-diff-code-view`
- `data-pierre-review-diff`
- `data-scrollbar="content"`
- `diffs-container` 仍使用 shadow DOM slot 承载 header toggle 和 metadata
  badge。

如果库不应携带 Tailwind class，组件仍保留这些 `data-*`
属性，并用普通 CSS 实现同等布局。演示页面可额外使用 app 侧 CSS 模拟 LoomDesk 视觉 token。

## 演示页面设计

新增 `apps/svelte-review-demo`，使用 Vite + Svelte 5，不引入 SvelteKit。

演示页面首屏就是差异区域，不做营销页。

界面结构：

- 顶部一条轻量控制区，仅用于验证组件能力：wrap、split/unified、collapse
  all、expand all、重新生成模拟数据。
- 主体是与 LoomDesk 差异区域一致的滚动容器。
- 模拟数据包含：
  - text 文件：普通修改，完整 old/new 文本。
  - virtual 文件：局部 patch，点击未修改行后模拟异步 hydration。
  - state 文件：binary、symlink 或 read error。
  - conflict 文件：使用 ours/worktree 渲染冲突差异。
  - notice：展示警告提示作为文件项。
- 演示页面的 hydration 模拟用 `setTimeout`
  返回 old/new 全文，验证组件方法和点击拦截链路。

演示页面只展示 diff 区域完整实现。工具栏里的按钮是演示外壳，不作为可迁移组件的一部分。

## 测试策略

核心库测试：

- `DiffHunksRenderer`：`formatUnmodifiedLines`
  会出现在 split 两侧和 unified 内容中。
- `CodeView`：`updateItem` 前捕获滚动锚点，内容增长或缩短后可见 item 不跳。
- `iterateOverDiff`：窗口从展开区域中间开始时不重复输出未修改行分隔文案。
- worker 类型或渲染选项：`formatUnmodifiedLines` 能进入 worker 参数快照。

Svelte 入口测试：

- jsdom 或 Vitest 挂载 `<ReviewDiff>`，确认：
  - worker 不存在时能降级。
  - `files/notices` 初次渲染会创建 CodeView items。
  - 同序内容变化走 `updateItem`。
  - 结构变化走分批重建并调用滚动锚点恢复。
  - header prefix slot 出现折叠按钮，点击后更新 `aria-expanded`。
  - state 文件 header metadata slot 出现 badge。
  - 点击 virtual diff 的未修改行区域触发 `onHydrationRequested`。
  - `hydrateFile` 能原地替换 partial diff。
  - `labels.formatUnmodifiedLines` 更新后渲染文案更新。

演示页面验证：

- `bun run format`
- `bun run lint`
- `bun run ws diffs tsc`
- `bun run ws diffs test`
- `bun run ws svelte-review-demo tsc`
- `bun run ws svelte-review-demo build`
- 用浏览器打开演示页面，确认桌面和窄屏下没有文本重叠，diff 区域可滚动，点击未修改行会完成 hydration。

## 迁移方式

LoomDesk 迁移后的目标形态：

```svelte
<script lang="ts">
  import ReviewDiff, type { ReviewDiffLabels } from '@pierre/diffs/svelte/review';

  const labels: ReviewDiffLabels = {
    ariaLabel: m.review_diff_aria_label(),
    collapseFile: m.review_collapse_file(),
    expandFile: m.review_expand_file(),
    noticeTitle: m.review_diff_notice_title(),
    binaryFile: m.review_diff_state_binary(),
    symlinkFile: m.review_diff_state_symlink(),
    invalidTextEncoding: m.review_diff_state_invalid_encoding(),
    readError: m.review_diff_state_read_error(),
    formatUnmodifiedLines: (count) => m.review_diff_unmodified_lines({ count }),
  };
</script>

<ReviewDiff
  bind:this={reviewDiff}
  files={resultFiles(result)}
  notices={notices}
  wrap={options.wrapLines}
  collapsed={options.collapsed}
  diffStyle={options.diffStyle}
  {labels}
  {onHydrationRequested}
/>
```

LoomDesk 保留：

- IPC 拉取 patch。
- hydrate IPC。
- Git watch 和 stale 状态。
- 审查工具栏和范围选择。

LoomDesk 删除或缩薄：

- `pierre-review-code-view.svelte`
- `diff-worker-pool.ts`
- `review-diff-theme.ts` 中只为 CodeView worker 和 slot 服务的部分
- 大量与 CodeView item 增量更新、分批重建、slot 同步相关的本地逻辑

## 风险和处理

- Svelte 组件打包：先验证 `tsdown` 对 `.svelte`
  文件的复制和类型声明；不满足时引入专门的 Svelte 打包流程。
- React peer 依赖：`@pierre/diffs`
  现有 peer 依赖包含 React。Svelte 子路径不应强制消费者安装 React，后续计划中需要评估 package
  peer 结构是否要调整。
- CSS 归属：如果把 LoomDesk 的 Tailwind
  class 直接放进库，会绑定调用方构建链。第一版优先用普通 CSS 和 `data-*`
  属性，演示页面再模拟 LoomDesk token。
- 高阶组件泛化边界：`ReviewDiffFile`
  会接近 LoomDesk 数据形状，但不包含 IPC、Git 查询和业务错误态，避免库越界。
- 性能回归：分批重建和 worker 降级路径需要保留 LoomDesk 当前验证过的阈值，测试覆盖同序更新、大批量变更和销毁清理。

## 待实施确认

已确认：

- 演示页面做独立 `apps/svelte-review-demo`。
- 公开入口用 `@pierre/diffs/svelte/review` 高阶组件。
- 输入类型基本复刻 LoomDesk 当前 `GitDiffReviewFile`，改名为 `ReviewDiffFile`。
- 可见文案通过 `labels` 参数传入，库提供英文默认值。

下一步进入实施计划时，需要把任务拆成：核心 patch 回流、Svelte 入口、演示应用、测试和文档五组。
