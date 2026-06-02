# Svelte 审查差异区域实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 LoomDesk 当前依赖的 `@pierre/diffs`
patch 能力回流到库中，并提供可直接迁移的 Svelte 审查差异区域组件和演示页面。

**Architecture:** 核心 diff 行为继续留在 `packages/diffs/src`
的现有渲染器、虚拟列表和 worker 架构里；Svelte 入口只负责把 `ReviewDiffFile[]`
转成 `CodeViewItem[]`、管理生命周期、slot、hydration 和样式。演示应用独立放在
`apps/svelte-review-demo`，模拟 LoomDesk 的 diff 区域外壳，但不把 LoomDesk 的 IPC、i18n 或业务 UI 引入库。

**Tech Stack:** Bun、TypeScript、`@pierre/diffs`、Svelte
5、Vite、`@sveltejs/package`、Bun test、jsdom。

**执行约束:**
用户已明确要求“后续不要主动提交代码，全部完成后审查再提交”。本计划中的每个“检查点”只运行验证和汇报
`git diff --stat`，不得执行 `git commit`。

---

## 文件结构

- Modify: `package.json`  
  在 `workspaces.catalog` 中加入 Svelte 相关依赖的精确版本。
- Modify: `packages/diffs/package.json`  
  新增 `./svelte/review` 导出、Svelte 构建脚本、Svelte peer 元数据和开发依赖。
- Modify: `packages/diffs/tsdown.config.ts`  
  让 tsdown 继续构建核心 TS/React 入口，同时避免和 `svelte-package`
  重复处理 Svelte 源码。
- Create: `packages/diffs/svelte.config.js`  
  供 `svelte-package`、`svelte-check` 和演示应用统一读取。
- Create: `packages/diffs/tsconfig.svelte.json`  
  专门检查 `src/svelte/**/*.svelte` 和相关 Svelte TS 文件。
- Modify: `packages/diffs/src/types.ts`  
  新增 `formatUnmodifiedLines` 类型。
- Modify: `packages/diffs/src/renderers/DiffHunksRenderer.ts`  
  默认化并使用 `formatUnmodifiedLines`。
- Modify: `packages/diffs/src/utils/getDiffHunksRendererOptions.ts`  
  把新选项从 `CodeView` item options 传给渲染器。
- Modify: `packages/diffs/src/components/CodeView.ts`  
  透传新 diff 选项，并在 `updateItem` 开始时捕获滚动锚点。
- Modify: `packages/diffs/test/DiffHunksRender.test.ts`  
  覆盖 split/unified 的未修改行文案格式化。
- Modify: `packages/diffs/test/CodeView.scrollAnchoring.test.ts`  
  覆盖 `updateItem` 替换前方内容时锚点不跳。
- Modify: `packages/diffs/test/iterateOverDiff.test.ts`  
  补齐 split/both 的窗口化分隔行边界回归测试。
- Create: `packages/diffs/src/svelte/review/types.ts`  
  定义 `ReviewDiffFile`、`ReviewDiffLabels`、`ReviewDiffHandle` 等公共类型。
- Create: `packages/diffs/src/svelte/review/labels.ts`  
  合并默认英文文案和调用方传入文案。
- Create: `packages/diffs/src/svelte/review/fileItems.ts`  
  把审查文件模型转换为 `CodeViewItem[]`。
- Create: `packages/diffs/src/svelte/review/reviewDiffTheme.ts`  
  生成库默认样式和可覆盖 CSS。
- Create: `packages/diffs/src/svelte/review/workerPool.ts`  
  引用计数 worker 池，浏览器不可用或创建失败时降级。
- Create: `packages/diffs/src/svelte/review/ReviewDiff.svelte`  
  Svelte 5 高阶组件，管理 `CodeView`、slot、增量更新、hydration 和销毁。
- Create: `packages/diffs/src/svelte/review/index.ts`  
  默认导出组件并导出类型。
- Create: `packages/diffs/test/ReviewDiff.svelte.test.ts`  
  通过 Svelte `mount` + jsdom 验证入口行为。
- Create: `apps/svelte-review-demo/*`  
  新增 Vite + Svelte 5 演示应用。
- Modify: `tsconfig.json`  
  增加 `apps/svelte-review-demo/tsconfig.json` 引用。

参考依据：

- Svelte 官方 `bind:this` 文档说明绑定值在挂载前是
  `undefined`，组件方法只能在 effect 或事件之后读取：<https://svelte.dev/docs/svelte/bind#bind:this>
- Svelte 官方命令式 API 文档说明 `mount` 返回组件导出的实例能力，适合测试
  `ReviewDiffHandle`：<https://svelte.dev/docs/svelte/imperative-component-api>
- SvelteKit 官方打包文档说明 `svelte-package` 会输出
  `.svelte`、TS 转译结果和类型声明，并要求 `exports.types`
  指向正确文件：<https://svelte.dev/docs/kit/packaging>
- `@sveltejs/vite-plugin-svelte` 官方 README 使用 `svelte()`
  作为 Vite 插件：<https://github.com/sveltejs/vite-plugin-svelte/tree/main/packages/vite-plugin-svelte>

---

### Task 1: 构建和依赖脚手架

**Files:**

- Modify: `package.json`
- Modify: `packages/diffs/package.json`
- Modify: `packages/diffs/tsdown.config.ts`
- Create: `packages/diffs/svelte.config.js`
- Create: `packages/diffs/tsconfig.svelte.json`

- [ ] **Step 1: 添加 catalog 依赖**

在根 `package.json` 的 `workspaces.catalog` 中加入精确版本：

```json
"@sveltejs/package": "2.5.7",
"@sveltejs/vite-plugin-svelte": "7.1.2",
"svelte": "5.56.0",
"svelte-check": "4.5.0"
```

这些版本用 `bun info <package> version` 查询得到。不要在子包里写直接版本号。

- [ ] **Step 2: 更新 `packages/diffs/package.json`**

把 scripts 改成两段构建，保留现有 `build` 入口：

```json
"scripts": {
  "build": "bun run build:ts && bun run build:svelte",
  "build:ts": "tsdown --clean",
  "build:svelte": "svelte-package --input src/svelte --output dist/svelte --tsconfig ./tsconfig.svelte.json",
  "check:svelte": "svelte-check --tsconfig ./tsconfig.svelte.json",
  "dev": "echo 'Watching for changes…' && tsdown --watch --log-level error",
  "benchmark:parse-merge-conflict": "bun run ./scripts/benchmarkParseMergeConflictDiffFromFile.ts",
  "test": "bun test",
  "tsc": "bun run check:svelte && tsgo --noEmit --pretty",
  "prepublishOnly": "bun run build"
}
```

在 `exports` 增加：

```json
"./svelte/review": {
  "types": "./dist/svelte/review/index.d.ts",
  "svelte": "./dist/svelte/review/ReviewDiff.svelte",
  "import": "./dist/svelte/review/index.js"
}
```

在 `typesVersions["*"]` 增加：

```json
"svelte/review": [
  "dist/svelte/review/index.d.ts"
]
```

把 peer 依赖改成 Svelte 和 React 都可选，避免 Svelte 消费者被迫安装 React：

```json
"peerDependencies": {
  "react": "^18.3.1 || ^19.0.0",
  "react-dom": "^18.3.1 || ^19.0.0",
  "svelte": "^5.0.0"
},
"peerDependenciesMeta": {
  "react": { "optional": true },
  "react-dom": { "optional": true },
  "svelte": { "optional": true }
}
```

在 `devDependencies` 增加 catalog 引用：

```json
"@sveltejs/package": "catalog:",
"svelte": "catalog:",
"svelte-check": "catalog:"
```

- [ ] **Step 3: 避免 tsdown 重复处理 Svelte 源码**

在 `packages/diffs/tsdown.config.ts` 第一段 `entry` 加排除项：

```ts
entry: [
  'src/**/*.ts',
  'src/**/*.tsx',
  '!src/svelte/**/*.ts',
  '!src/worker/worker.ts',
  '!src/worker/worker-portable.ts',
],
```

Svelte 入口里的 `.ts` 文件由 `svelte-package` 输出到 `dist/svelte`。

- [ ] **Step 4: 新增 Svelte 配置**

创建 `packages/diffs/svelte.config.js`：

```js
const config = {};

export default config;
```

这里不启用 Svelte 4 兼容 API；组件公开方法用 Svelte 5 的 `export function`，由
`bind:this` 和 `mount` 返回。

- [ ] **Step 5: 新增 Svelte 类型检查配置**

创建 `packages/diffs/tsconfig.svelte.json`：

```json
{
  "extends": "./tsconfig.json",
  "include": ["src/svelte/**/*.ts", "src/svelte/**/*.svelte"],
  "compilerOptions": {
    "rootDir": ".",
    "allowJs": true,
    "checkJs": false
  }
}
```

- [ ] **Step 6: 安装依赖并验证锁文件**

Run:

```bash
bun install
git diff -- package.json packages/diffs/package.json packages/diffs/tsdown.config.ts packages/diffs/svelte.config.js packages/diffs/tsconfig.svelte.json bun.lock
```

Expected:

- `bun.lock` 只增加 Svelte 相关依赖。
- 没有子包直接版本号。

- [ ] **Step 7: 检查点，不提交**

Run:

```bash
git diff --stat
git status --short
```

Expected:

- 只有计划内文件变化。
- 不执行 `git commit`。

---

### Task 2: 未修改行文案格式化

**Files:**

- Modify: `packages/diffs/src/types.ts`
- Modify: `packages/diffs/src/renderers/DiffHunksRenderer.ts`
- Modify: `packages/diffs/src/utils/getDiffHunksRendererOptions.ts`
- Modify: `packages/diffs/src/components/CodeView.ts`
- Modify: `packages/diffs/test/DiffHunksRender.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `packages/diffs/test/DiffHunksRender.test.ts` 的
`describe('DiffHunksRenderer', () => { ... })` 内新增：

```ts
test('formats collapsed separator labels with formatUnmodifiedLines', async () => {
  const oldFile = {
    name: 'separator.ts',
    contents: [
      'same 1',
      'same 2',
      'same 3',
      'same 4',
      'same 5',
      'same 6',
      'same 7',
      'same 8',
      'old value',
      'tail 1',
      'tail 2',
    ].join('\n'),
  };
  const newFile = {
    name: 'separator.ts',
    contents: [
      'same 1',
      'same 2',
      'same 3',
      'same 4',
      'same 5',
      'same 6',
      'same 7',
      'same 8',
      'new value',
      'tail 1',
      'tail 2',
    ].join('\n'),
  };
  const diff = parseDiffFromFile(oldFile, newFile);

  const split = new DiffHunksRenderer({
    diffStyle: 'split',
    formatUnmodifiedLines: (count) => `${count} 行未修改`,
  });
  const splitHtml = split.renderFullHTML(await split.asyncRender(diff));
  expect(splitHtml).toContain('行未修改');
  expect(splitHtml).not.toContain('unmodified line');

  const unified = new DiffHunksRenderer({
    diffStyle: 'unified',
    formatUnmodifiedLines: (count) => `${count} 行未修改`,
  });
  const unifiedHtml = unified.renderFullHTML(await unified.asyncRender(diff));
  expect(unifiedHtml).toContain('行未修改');
  expect(unifiedHtml).not.toContain('unmodified line');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd packages/diffs && bun test test/DiffHunksRender.test.ts --filter "formats collapsed separator labels"
```

Expected:

- FAIL，TypeScript 或运行期提示 `formatUnmodifiedLines`
  不存在，或 HTML 仍包含默认英文。

- [ ] **Step 3: 扩展核心类型**

在 `packages/diffs/src/types.ts` 的 `BaseDiffOptions` 中 `hunkSeparators`
后加入：

```ts
  formatUnmodifiedLines?: (lines: number) => string;
```

把 `BaseDiffOptionsWithDefaults` 的 omit 扩展为保留函数可选性：

```ts
export type BaseDiffOptionsWithDefaults = Required<
  Omit<
    BaseDiffOptions,
    | 'unsafeCSS'
    | 'preferredHighlighter'
    | 'parseDiffOptions'
    | 'formatUnmodifiedLines'
  >
> & {
  formatUnmodifiedLines: (lines: number) => string;
};
```

- [ ] **Step 4: 在渲染器默认化并使用 formatter**

在 `packages/diffs/src/renderers/DiffHunksRenderer.ts` 的 `ProcessContext`
加字段：

```ts
  formatUnmodifiedLines(lines: number): string;
```

在 `getOptionsWithDefaults()` 解构默认值：

```ts
      formatUnmodifiedLines = getModifiedLinesString,
```

并在返回对象中加入：

```ts
      formatUnmodifiedLines,
```

在 `processDiffResult()` 解构：

```ts
      formatUnmodifiedLines,
```

创建 `context` 时加入：

```ts
      formatUnmodifiedLines,
```

在 `pushSeparator()` 中替换两处 `getModifiedLinesString(collapsedLines)`：

```ts
      content: context.formatUnmodifiedLines(collapsedLines),
```

保留 `getModifiedLinesString` 作为默认函数。

- [ ] **Step 5: 透传 CodeView 选项**

在 `packages/diffs/src/utils/getDiffHunksRendererOptions.ts` 的返回对象加入：

```ts
    formatUnmodifiedLines: options?.formatUnmodifiedLines,
```

在 `packages/diffs/src/components/CodeView.ts` 的 `CODE_VIEW_DIFF_OPTION_KEYS`
中加入：

```ts
  'formatUnmodifiedLines',
```

不要把该函数加入 `WorkerRenderingOptions` 或
`RenderDiffOptions`。Worker 消息必须保持可结构化复制；未修改行分隔符在主线程
`processDiffResult()` 中生成。

- [ ] **Step 6: 运行目标测试**

Run:

```bash
cd packages/diffs && bun test test/DiffHunksRender.test.ts --filter "formats collapsed separator labels"
```

Expected:

- PASS。

- [ ] **Step 7: 检查点，不提交**

Run:

```bash
git diff -- packages/diffs/src/types.ts packages/diffs/src/renderers/DiffHunksRenderer.ts packages/diffs/src/utils/getDiffHunksRendererOptions.ts packages/diffs/src/components/CodeView.ts packages/diffs/test/DiffHunksRender.test.ts
git status --short
```

Expected:

- diff 只包含 formatter 类型、默认值、透传和测试。
- 不执行 `git commit`。

---

### Task 3: `CodeView.updateItem` 滚动锚点

**Files:**

- Modify: `packages/diffs/src/components/CodeView.ts`
- Modify: `packages/diffs/test/CodeView.scrollAnchoring.test.ts`

- [ ] **Step 1: 先写失败测试**

在 `packages/diffs/test/CodeView.scrollAnchoring.test.ts` 的
`describe('CodeView scroll anchoring', () => { ... })` 内新增：

```ts
test('keeps the visible item anchored when updateItem grows content above it', async () => {
  const { cleanup } = installDom();
  const viewer = new CodeView();
  const root = createClampingRoot();
  const growing = makeFileItem('file:growing', 40);
  const anchor = makeFileItem('file:anchor', 30);

  try {
    viewer.setup(root);
    await renderItems(viewer, [growing, anchor]);

    const initialAnchorTop =
      DEFAULT_CODE_VIEW_LAYOUT.paddingTop +
      (viewer.getTopForItem(anchor.id) ?? 0);
    root.scrollTop = initialAnchorTop;
    dispatchScroll(root);
    viewer.render(true);

    expect(viewer.updateItem(makeFileItem('file:growing', 140))).toBe(true);
    viewer.render(true);

    const updatedAnchorTop =
      DEFAULT_CODE_VIEW_LAYOUT.paddingTop +
      (viewer.getTopForItem(anchor.id) ?? 0);
    expect(updatedAnchorTop).toBeGreaterThan(initialAnchorTop);
    expect(root.scrollTop).toBe(updatedAnchorTop);
  } finally {
    viewer.cleanUp();
    await wait(0);
    cleanup();
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd packages/diffs && bun test test/CodeView.scrollAnchoring.test.ts --filter "keeps the visible item anchored"
```

Expected:

- FAIL，`root.scrollTop` 保持旧值或没有跟随更新后的 anchor top。

- [ ] **Step 3: 实现最小修复**

在 `packages/diffs/src/components/CodeView.ts` 的 `updateItem` 开头加入：

```ts
  public updateItem(input: CodeViewItem<LAnnotation>): boolean {
    this.capturePendingLayoutAnchor();

    const item = this.idToItem.get(input.id);
```

该调用必须在 `idToItem.get()` 之前，保证未知 id 的错误路径也不会复用旧锚点。

- [ ] **Step 4: 运行目标测试**

Run:

```bash
cd packages/diffs && bun test test/CodeView.scrollAnchoring.test.ts --filter "keeps the visible item anchored"
```

Expected:

- PASS。

- [ ] **Step 5: 检查点，不提交**

Run:

```bash
git diff -- packages/diffs/src/components/CodeView.ts packages/diffs/test/CodeView.scrollAnchoring.test.ts
git status --short
```

Expected:

- diff 只包含锚点调用和回归测试。
- 不执行 `git commit`。

---

### Task 4: 窗口化分隔行边界回归覆盖

**Files:**

- Modify: `packages/diffs/src/utils/iterateOverDiff.ts`
- Modify: `packages/diffs/test/iterateOverDiff.test.ts`

- [ ] **Step 1: 补齐 split 和 both 测试**

在 `packages/diffs/test/iterateOverDiff.test.ts` 的现有
`windowed expansion does not attach skipped collapsed separators to visible rows`
测试后新增：

```ts
test('windowed expansion does not attach skipped collapsed separators in split mode', () => {
  const rows = collectRows({
    diff: createWindowedSeparatorDiff([
      {
        type: 'context',
        lines: 3,
        deletionLineIndex: COLLAPSED_BEFORE,
        additionLineIndex: COLLAPSED_BEFORE,
      },
    ]),
    diffStyle: 'split',
    expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 0 }]]),
    startingLine: 3,
    totalLines: 1,
  });

  expect(rows).toEqual([
    expect.objectContaining({ type: 'context', collapsedBefore: 0 }),
  ]);
});

test('windowed expansion does not attach skipped collapsed separators in both mode', () => {
  const rows = collectRows({
    diff: createWindowedSeparatorDiff([
      {
        type: 'change',
        deletions: 3,
        deletionLineIndex: COLLAPSED_BEFORE,
        additions: 1,
        additionLineIndex: COLLAPSED_BEFORE,
      },
    ]),
    diffStyle: 'both',
    expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 0 }]]),
    startingLine: 3,
    totalLines: 1,
  });

  expect(rows.every((row) => row.collapsedBefore === 0)).toBe(true);
});
```

- [ ] **Step 2: 运行测试**

Run:

```bash
cd packages/diffs && bun test test/iterateOverDiff.test.ts --filter "windowed expansion does not attach skipped collapsed separators"
```

Expected:

- 如果 PASS，当前 `iterateOverDiff` 已经包含等价修复，不改实现。
- 如果 FAIL，继续 Step 3。

- [ ] **Step 3: 仅在失败时修复 `iterateOverDiff`**

在 `packages/diffs/src/utils/iterateOverDiff.ts` 确保存在这一组逻辑：

```ts
let consumedCollapsed = leadingRegion.collapsedLines === 0;
function consumePendingCollapsed() {
  if (consumedCollapsed) {
    return 0;
  }
  consumedCollapsed = true;
  return leadingRegion.collapsedLines;
}
```

并确保窗口从 expanded/context/change 中间开始时调用
`consumePendingCollapsed()`，包括：

```ts
() => {
  consumePendingCollapsed();
};
```

和：

```ts
if (firstRangeStart > 0) {
  consumePendingCollapsed();
}
```

当前仓库已有相近实现；不要为了“对齐 patch”重复重写。

- [ ] **Step 4: 运行目标测试**

Run:

```bash
cd packages/diffs && bun test test/iterateOverDiff.test.ts --filter "windowed expansion does not attach skipped collapsed separators"
```

Expected:

- PASS。

- [ ] **Step 5: 检查点，不提交**

Run:

```bash
git diff -- packages/diffs/src/utils/iterateOverDiff.ts packages/diffs/test/iterateOverDiff.test.ts
git status --short
```

Expected:

- 如果实现未改，只有测试变化。
- 不执行 `git commit`。

---

### Task 5: Svelte 公开类型和文件转换

**Files:**

- Create: `packages/diffs/src/svelte/review/types.ts`
- Create: `packages/diffs/src/svelte/review/labels.ts`
- Create: `packages/diffs/src/svelte/review/fileItems.ts`
- Create: `packages/diffs/src/svelte/review/index.ts`
- Create: `packages/diffs/test/ReviewDiff.fileItems.test.ts`

- [ ] **Step 1: 写文件转换测试**

创建 `packages/diffs/test/ReviewDiff.fileItems.test.ts`：

```ts
import { describe, expect, test } from 'bun:test';

import {
  createReviewDiffItems,
  resolveReviewDiffLabels,
} from '../src/svelte/review/index';
import type { ReviewDiffFile } from '../src/svelte/review/index';

const files: ReviewDiffFile[] = [
  {
    id: 'text:1',
    kind: 'text',
    path: 'src/app.ts',
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    oldText: 'const a = 1;\n',
    newText: 'const a = 2;\n',
    byteSize: 24,
    lineCount: 1,
    patch: '',
  },
  {
    id: 'virtual:1',
    kind: 'virtual',
    path: 'src/partial.ts',
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    patch: [
      'diff --git a/src/partial.ts b/src/partial.ts',
      '--- a/src/partial.ts',
      '+++ b/src/partial.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      '',
    ].join('\n'),
    byteSize: 20,
    lineCount: 1,
    contextLines: 3,
    canExpandContext: true,
  },
  {
    id: 'state:1',
    kind: 'state',
    path: 'assets/logo.png',
    oldPath: null,
    status: 'binary',
    group: 'unstaged',
    reason: 'binary_file',
    byteSize: 1024,
    message: null,
  },
];

describe('ReviewDiff file item conversion', () => {
  test('converts notices and review files into stable CodeView items', () => {
    const labels = resolveReviewDiffLabels({
      noticeTitle: 'Notice',
      binaryFile: 'Binary file',
      formatUnmodifiedLines: (count) => `${count} 行未修改`,
    });
    const items = createReviewDiffItems({
      files,
      notices: ['Large file was truncated'],
      collapsed: false,
      labels,
    });

    expect(items.map((item) => item.id)).toEqual([
      'notice:0',
      'text:1',
      'virtual:1',
      'state:1',
    ]);
    expect(items[0]?.type).toBe('file');
    expect(items[1]?.type).toBe('diff');
    expect(items[2]?.type).toBe('diff');
    expect(items[3]?.type).toBe('file');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd packages/diffs && bun test test/ReviewDiff.fileItems.test.ts
```

Expected:

- FAIL，模块不存在。

- [ ] **Step 3: 定义公共类型**

创建 `packages/diffs/src/svelte/review/types.ts`，内容按设计文档定义
`ReviewDiffFileGroup`、`ReviewDiffFileStatus`、四类文件、`ReviewDiffFile`、`ReviewDiffLabels`、`ReviewDiffProps`、`ReviewDiffHandle`。

组件 props 额外保留库级覆盖入口：

```ts
import type { DiffHunksRendererOptions } from '../../renderers/DiffHunksRenderer.js';

export interface ReviewDiffProps {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  wrap?: boolean;
  collapsed?: boolean;
  diffStyle?: 'split' | 'unified';
  labels?: ReviewDiffLabels;
  onHydrationRequested?: (fileId: string) => void;
  class?: string;
  codeViewOptions?: Pick<
    DiffHunksRendererOptions,
    'theme' | 'unsafeCSS' | 'useCSSClasses' | 'tokenizeMaxLineLength'
  >;
}
```

所有从 `src/svelte` 到核心库的相对 import 使用 `.js` 后缀，保证打包后符合 ESM。

- [ ] **Step 4: 实现 labels 合并**

创建 `packages/diffs/src/svelte/review/labels.ts`：

```ts
import type { ReviewDiffLabels } from './types.js';

export interface ResolvedReviewDiffLabels {
  ariaLabel: string;
  collapseFile: string;
  expandFile: string;
  noticeTitle: string;
  binaryFile: string;
  symlinkFile: string;
  invalidTextEncoding: string;
  readError: string;
  formatUnmodifiedLines(count: number): string;
}

export function resolveReviewDiffLabels(
  labels: ReviewDiffLabels | undefined
): ResolvedReviewDiffLabels {
  return {
    ariaLabel: labels?.ariaLabel ?? 'Review diff',
    collapseFile: labels?.collapseFile ?? 'Collapse file',
    expandFile: labels?.expandFile ?? 'Expand file',
    noticeTitle: labels?.noticeTitle ?? 'Notice',
    binaryFile: labels?.binaryFile ?? 'Binary file',
    symlinkFile: labels?.symlinkFile ?? 'Symbolic link',
    invalidTextEncoding: labels?.invalidTextEncoding ?? 'Invalid text encoding',
    readError: labels?.readError ?? 'Unable to read file',
    formatUnmodifiedLines:
      labels?.formatUnmodifiedLines ??
      ((count) => `${count} unmodified line${count > 1 ? 's' : ''}`),
  };
}
```

- [ ] **Step 5: 实现文件转换**

创建 `packages/diffs/src/svelte/review/fileItems.ts`。核心函数：

```ts
import type { CodeViewItem, FileContents } from '../../types.js';
import { parseDiffFromFile } from '../../utils/parseDiffFromFile.js';
import { processFile } from '../../utils/parsePatchFiles.js';
import type { ResolvedReviewDiffLabels } from './labels.js';
import type { ReviewDiffFile } from './types.js';

interface CreateReviewDiffItemsInput {
  files: readonly ReviewDiffFile[];
  notices: readonly string[];
  collapsed: boolean;
  labels: ResolvedReviewDiffLabels;
}

export function createReviewDiffItems({
  files,
  notices,
  collapsed,
  labels,
}: CreateReviewDiffItemsInput): CodeViewItem[] {
  return [
    ...notices.map((notice, index) => createNoticeItem(notice, index, labels)),
    ...files.map((file) => createFileItem(file, collapsed, labels)),
  ];
}
```

实现规则：

- `text`：用 `parseDiffFromFile(toFileContents(old), toFileContents(new))`。
- `virtual`：用
  `processFile(file.patch, { cacheKey: file.id })`，失败时转成 state file。
- `conflict`：先用 `oursText ?? baseText ?? ''` 和 `worktreeText` 生成 diff。
- `state` 和 notice：转成 `type: 'file'`，contents 为单行可读状态文本。
- 所有 item 使用 `version`
  指纹，指纹由文件关键字段组成，确保同 id 内容变化能触发 `CodeView.updateItem`。

辅助函数必须是线性时间，不在文件列表循环里做二次扫描：

```ts
function toFileContents(
  name: string,
  contents: string,
  cacheKey: string
): FileContents {
  return { name, contents, cacheKey };
}
```

- [ ] **Step 6: 导出入口**

创建 `packages/diffs/src/svelte/review/index.ts`：

```ts
export { createReviewDiffItems } from './fileItems.js';
export { resolveReviewDiffLabels } from './labels.js';
export { default } from './ReviewDiff.svelte';
export type * from './types.js';
```

`ReviewDiff.svelte` 在 Task
7 创建；此时测试会因为缺少组件默认导出失败，可先临时在 Task 5 只运行
`ReviewDiff.fileItems.test.ts` 并允许 TypeScript 后续解决，或先创建空组件占位：

```svelte
<script lang="ts">
  export function applyCollapseModeToLoaded(_nextCollapsed: boolean): void {}
  export function hydrateFile(
    _fileId: string,
    _patch: string,
    _oldText: string,
    _newText: string
  ): void {}
</script>
```

- [ ] **Step 7: 运行目标测试**

Run:

```bash
cd packages/diffs && bun test test/ReviewDiff.fileItems.test.ts
```

Expected:

- PASS。

- [ ] **Step 8: 检查点，不提交**

Run:

```bash
git diff -- packages/diffs/src/svelte/review packages/diffs/test/ReviewDiff.fileItems.test.ts
git status --short
```

Expected:

- Svelte review 类型和转换逻辑已存在。
- 不执行 `git commit`。

---

### Task 6: Svelte worker 池和主题样式

**Files:**

- Create: `packages/diffs/src/svelte/review/workerPool.ts`
- Create: `packages/diffs/src/svelte/review/reviewDiffTheme.ts`
- Modify: `packages/diffs/src/svelte/review/index.ts`

- [ ] **Step 1: 实现引用计数 worker 池**

创建 `packages/diffs/src/svelte/review/workerPool.ts`：

```ts
import { WorkerPoolManager } from '../../worker/WorkerPoolManager.js';
import type { WorkerInitializationRenderOptions } from '../../worker/types.js';

let sharedPool: WorkerPoolManager | undefined;
let references = 0;

export function acquireReviewWorkerPool(
  options: WorkerInitializationRenderOptions = {}
): WorkerPoolManager | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }

  references += 1;
  if (sharedPool != null) {
    return sharedPool;
  }

  try {
    sharedPool = new WorkerPoolManager(
      {
        workerFactory: () =>
          new Worker(
            new URL('../../worker/worker-portable.js', import.meta.url),
            { type: 'module' }
          ),
      },
      options
    );
    return sharedPool;
  } catch {
    references -= 1;
    sharedPool = undefined;
    return undefined;
  }
}

export function releaseReviewWorkerPool(): void {
  references = Math.max(0, references - 1);
  if (references === 0) {
    sharedPool?.terminate();
    sharedPool = undefined;
  }
}
```

注意：Worker URL 指向打包后的同包路径；后续 build 验证会确认
`dist/svelte/review/workerPool.js` 到 `dist/worker/worker-portable.js`
的相对路径正确。

- [ ] **Step 2: 实现默认样式**

创建 `packages/diffs/src/svelte/review/reviewDiffTheme.ts`：

```ts
export const REVIEW_DIFF_CLASS = 'pierre-review-diff';

export const REVIEW_DIFF_UNSAFE_CSS = `
:host, diffs-container {
  color-scheme: light dark;
}
[data-separator-content],
[data-unmodified-lines] {
  cursor: pointer;
}
`;
```

组件外层样式在 `.svelte` 里写普通 CSS，不写 Tailwind class。

- [ ] **Step 3: 导出 worker 工具**

在 `packages/diffs/src/svelte/review/index.ts` 加：

```ts
export {
  acquireReviewWorkerPool,
  releaseReviewWorkerPool,
} from './workerPool.js';
```

这些导出用于测试，不作为 LoomDesk 迁移必须调用的 API。

- [ ] **Step 4: 运行类型检查**

Run:

```bash
cd packages/diffs && bun run check:svelte
```

Expected:

- 如果 `ReviewDiff.svelte` 还是占位，Svelte
  check 应通过或只暴露下一任务需要处理的组件缺口。

- [ ] **Step 5: 检查点，不提交**

Run:

```bash
git diff -- packages/diffs/src/svelte/review/workerPool.ts packages/diffs/src/svelte/review/reviewDiffTheme.ts packages/diffs/src/svelte/review/index.ts
git status --short
```

Expected:

- 不执行 `git commit`。

---

### Task 7: `ReviewDiff.svelte` 组件

**Files:**

- Modify: `packages/diffs/src/svelte/review/ReviewDiff.svelte`
- Modify: `packages/diffs/src/svelte/review/fileItems.ts`
- Create: `packages/diffs/test/ReviewDiff.svelte.test.ts`

- [ ] **Step 1: 写组件行为测试**

创建 `packages/diffs/test/ReviewDiff.svelte.test.ts`：

```ts
import { afterEach, describe, expect, test } from 'bun:test';
import { JSDOM } from 'jsdom';
import { flushSync, mount, unmount } from 'svelte';

import ReviewDiff, {
  type ReviewDiffFile,
  type ReviewDiffHandle,
} from '../src/svelte/review/index';

function installDom() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="app"></div></body></html>',
    {
      url: 'http://localhost',
    }
  );
  const originalDocument = Reflect.get(globalThis, 'document');
  const originalWindow = Reflect.get(globalThis, 'window');
  const originalHTMLElement = Reflect.get(globalThis, 'HTMLElement');
  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    HTMLElement: dom.window.HTMLElement,
  });
  return {
    target: dom.window.document.querySelector('#app') as HTMLElement,
    cleanup() {
      if (originalDocument === undefined)
        Reflect.deleteProperty(globalThis, 'document');
      else Object.assign(globalThis, { document: originalDocument });
      if (originalWindow === undefined)
        Reflect.deleteProperty(globalThis, 'window');
      else Object.assign(globalThis, { window: originalWindow });
      if (originalHTMLElement === undefined)
        Reflect.deleteProperty(globalThis, 'HTMLElement');
      else Object.assign(globalThis, { HTMLElement: originalHTMLElement });
      dom.window.close();
    },
  };
}

const files: ReviewDiffFile[] = [
  {
    id: 'virtual:hydration',
    kind: 'virtual',
    path: 'src/demo.ts',
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    patch: [
      'diff --git a/src/demo.ts b/src/demo.ts',
      '--- a/src/demo.ts',
      '+++ b/src/demo.ts',
      '@@ -1,1 +1,1 @@',
      '-old',
      '+new',
      '',
    ].join('\n'),
    byteSize: 20,
    lineCount: 1,
    contextLines: 3,
    canExpandContext: true,
  },
];

describe('ReviewDiff.svelte', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('mounts a review diff region and exposes hydration methods', async () => {
    const { target, cleanup } = installDom();
    const requested: string[] = [];
    let app: ReviewDiffHandle | undefined;

    try {
      app = mount(ReviewDiff, {
        target,
        props: {
          files,
          notices: ['Notice'],
          labels: {
            ariaLabel: '差异内容',
            formatUnmodifiedLines: (count) => `${count} 行未修改`,
          },
          onHydrationRequested: (fileId) => requested.push(fileId),
        },
      });
      flushSync();

      const region = target.querySelector('[data-pierre-review-diff]');
      expect(region).toBeInstanceOf(HTMLElement);
      expect(region?.getAttribute('aria-label')).toBe('差异内容');

      app.hydrateFile(
        'virtual:hydration',
        files[0]?.kind === 'virtual' ? files[0].patch : '',
        'old\n',
        'new\n'
      );
      app.applyCollapseModeToLoaded(true);
      flushSync();

      expect(typeof app.hydrateFile).toBe('function');
      expect(typeof app.applyCollapseModeToLoaded).toBe('function');
    } finally {
      if (app != null) {
        await unmount(app);
      }
      cleanup();
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
cd packages/diffs && bun test test/ReviewDiff.svelte.test.ts
```

Expected:

- FAIL，组件还是占位或未创建真实 DOM。

- [ ] **Step 3: 实现组件外层和生命周期**

在 `ReviewDiff.svelte` 中使用 Svelte 5 runes：

```svelte
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import { CodeView } from '../../components/CodeView.js';
  import type { CodeViewItem } from '../../types.js';
  import { acquireReviewWorkerPool, releaseReviewWorkerPool } from './workerPool.js';
  import { createReviewDiffItems } from './fileItems.js';
  import { resolveReviewDiffLabels } from './labels.js';
  import { REVIEW_DIFF_CLASS, REVIEW_DIFF_UNSAFE_CSS } from './reviewDiffTheme.js';
  import type { ReviewDiffFile, ReviewDiffProps } from './types.js';

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
  }: ReviewDiffProps = $props();

  let host: HTMLDivElement | undefined = $state();
  let viewer: CodeView | undefined;
  let loadedItems = new Map<string, CodeViewItem>();

  const resolvedLabels = $derived(resolveReviewDiffLabels(labels));
  const items = $derived(
    createReviewDiffItems({
      files,
      notices,
      collapsed,
      labels: resolvedLabels,
    })
  );

  onMount(() => {
    if (host == null) return;
    const workerManager = acquireReviewWorkerPool({
      theme: codeViewOptions?.theme,
    });
    viewer = new CodeView(
      {
        ...codeViewOptions,
        unsafeCSS: [REVIEW_DIFF_UNSAFE_CSS, codeViewOptions?.unsafeCSS]
          .filter(Boolean)
          .join('\n'),
        diffStyle,
        overflow: wrap ? 'wrap' : 'scroll',
        stickyHeaders: true,
        hunkSeparators: 'line-info',
        formatUnmodifiedLines: resolvedLabels.formatUnmodifiedLines,
        renderHeaderPrefix: renderHeaderPrefix,
        renderHeaderMetadata: renderHeaderMetadata,
      },
      workerManager
    );
    viewer.setup(host);
    applyItems(items);
    return () => {
      viewer?.cleanUp();
      viewer = undefined;
      releaseReviewWorkerPool();
    };
  });

  onDestroy(() => {
    viewer?.cleanUp();
    viewer = undefined;
  });
</script>
```

`CodeView` 当前构造函数第二个参数接收
`WorkerPoolManager`，不要把 worker 池塞进公开 `CodeViewOptions`。

- [ ] **Step 4: 实现增量同步**

在组件脚本中加入：

```ts
$effect(() => {
  if (viewer == null) return;
  viewer.setOptions({
    ...codeViewOptions,
    diffStyle,
    overflow: wrap ? 'wrap' : 'scroll',
    stickyHeaders: true,
    hunkSeparators: 'line-info',
    formatUnmodifiedLines: resolvedLabels.formatUnmodifiedLines,
    renderHeaderPrefix,
    renderHeaderMetadata,
  });
});

$effect(() => {
  applyItems(items);
});

function applyItems(nextItems: readonly CodeViewItem[]): void {
  if (viewer == null) return;
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  const previousIds = Array.from(loadedItems.keys());
  const nextIds = nextItems.map((item) => item.id);
  const sameOrder =
    previousIds.length === nextIds.length &&
    previousIds.every((id, index) => id === nextIds[index]);

  if (!sameOrder) {
    viewer.setItems(nextItems);
    loadedItems = nextById;
    return;
  }

  for (const item of nextItems) {
    const previous = loadedItems.get(item.id);
    if (previous?.version !== item.version) {
      viewer.updateItem(item);
    }
  }
  loadedItems = nextById;
}
```

大批量变化阈值在实现中用常量，例如 `MAX_SYNC_UPDATES = 80`。超过阈值时调用
`viewer.setItems(nextItems)`，避免同步循环过长。

- [ ] **Step 5: 实现公开方法**

在组件脚本中加入：

```ts
export function applyCollapseModeToLoaded(nextCollapsed: boolean): void {
  if (viewer == null) return;
  const nextItems = Array.from(loadedItems.values()).map((item) => ({
    ...item,
    collapsed: nextCollapsed,
    version: (item.version ?? 0) + 1,
  }));
  viewer.setItems(nextItems);
  loadedItems = new Map(nextItems.map((item) => [item.id, item]));
}

export function hydrateFile(
  fileId: string,
  patch: string,
  oldText: string,
  newText: string
): void {
  const file = files.find((entry) => entry.id === fileId);
  if (file == null || file.kind !== 'virtual') {
    return;
  }
  const hydrated: ReviewDiffFile = {
    ...file,
    kind: 'text',
    oldText,
    newText,
    patch,
  };
  const item = createReviewDiffItems({
    files: [hydrated],
    notices: [],
    collapsed,
    labels: resolvedLabels,
  })[0];
  if (item == null || viewer == null) {
    return;
  }
  viewer.updateItem(item);
  loadedItems.set(item.id, item);
}
```

如果 TypeScript 不接受把 `virtual` spread 成 `text`，创建明确的
`ReviewDiffTextFile` 对象。

- [ ] **Step 6: 实现 header slot**

实现 `renderHeaderPrefix` 和 `renderHeaderMetadata`：

```ts
function renderHeaderPrefix(fileDiff: { name: string }): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pierre-review-diff__collapse';
  button.setAttribute('aria-label', resolvedLabels.collapseFile);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const item = loadedItems.get(fileDiff.name);
    if (item == null || viewer == null) return;
    const next = {
      ...item,
      collapsed: item.collapsed !== true,
      version: (item.version ?? 0) + 1,
    };
    viewer.updateItem(next);
    loadedItems.set(next.id, next);
  });
  return button;
}

function renderHeaderMetadata(fileDiff: {
  name: string;
}): HTMLElement | undefined {
  const file = files.find((entry) => entry.id === fileDiff.name);
  if (file?.kind !== 'state') {
    return undefined;
  }
  const badge = document.createElement('span');
  badge.className = 'pierre-review-diff__state-badge';
  badge.textContent = file.reason;
  return badge;
}
```

如果 `fileDiff.name` 不是 id，则在 `fileItems.ts` 中用
`FileDiffMetadata.cacheKey` 或 `name`
保持 id 可反查，不能做 O(n²) 全表扫描；预先建立 `Map<string, ReviewDiffFile>`。

- [ ] **Step 7: 实现外层 DOM 和点击 hydration**

组件 markup：

```svelte
<div
  bind:this={host}
  class={`${REVIEW_DIFF_CLASS} ${className}`}
  data-review-diff-code-view
  data-pierre-review-diff
  data-scrollbar="content"
  role="region"
  aria-label={resolvedLabels.ariaLabel}
  onclick={(event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const separator = target.closest('[data-unmodified-lines],[data-separator-content]');
    if (separator == null) return;
    const fileNode = target.closest('diffs-container');
    const fileId = fileNode?.getAttribute('data-file-id');
    if (fileId != null) {
      onHydrationRequested?.(fileId);
    }
  }}
></div>
```

样式：

```svelte
<style>
  .pierre-review-diff {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 20rem;
    height: 100%;
    flex: 1 1 auto;
    overflow-x: clip;
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--pierre-review-diff-border, color-mix(in srgb, currentColor 18%, transparent));
    border-radius: 0.5rem;
    background: var(--pierre-review-diff-background, Canvas);
    contain: strict;
    overflow-anchor: none;
  }

  :global(.pierre-review-diff__collapse) {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  :global(.pierre-review-diff__state-badge) {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.75rem;
    line-height: 1.5;
    background: var(--pierre-review-diff-badge-background, color-mix(in srgb, currentColor 12%, transparent));
  }
</style>
```

- [ ] **Step 8: 运行组件测试和 Svelte 检查**

Run:

```bash
cd packages/diffs && bun test test/ReviewDiff.svelte.test.ts
cd packages/diffs && bun run check:svelte
```

Expected:

- PASS。

- [ ] **Step 9: 检查点，不提交**

Run:

```bash
git diff -- packages/diffs/src/svelte/review packages/diffs/test/ReviewDiff.svelte.test.ts
git status --short
```

Expected:

- 不执行 `git commit`。

---

### Task 8: 演示应用

**Files:**

- Create: `apps/svelte-review-demo/package.json`
- Create: `apps/svelte-review-demo/tsconfig.json`
- Create: `apps/svelte-review-demo/vite.config.ts`
- Create: `apps/svelte-review-demo/index.html`
- Create: `apps/svelte-review-demo/src/main.ts`
- Create: `apps/svelte-review-demo/src/App.svelte`
- Create: `apps/svelte-review-demo/src/reviewFiles.ts`
- Create: `apps/svelte-review-demo/src/style.css`
- Modify: `tsconfig.json`

- [ ] **Step 1: 创建 package**

创建 `apps/svelte-review-demo/package.json`：

```json
{
  "name": "@pierre/svelte-review-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "bun run build:deps && vite build",
    "build:deps": "bun run build:deps:diffs",
    "build:deps:diffs": "output=$(cd ../../packages/diffs && bun run build 2>&1) && echo '[diffs] Successfully cleaned and built.' || (echo \"$output\" >&2 && exit 1)",
    "dev": "bun run build:deps && vite --host --clearScreen=false",
    "preview": "vite preview",
    "start": "vite preview",
    "tsc": "bun run build:deps && svelte-check --tsconfig ./tsconfig.json && tsgo --noEmit --pretty"
  },
  "dependencies": {
    "@pierre/diffs": "workspace:*",
    "svelte": "catalog:"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "catalog:",
    "svelte-check": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:"
  }
}
```

- [ ] **Step 2: 创建 tsconfig**

创建 `apps/svelte-review-demo/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.options.json",
  "include": ["src/**/*", "vite.config.ts"],
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "emitDeclarationOnly": false,
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
  },
  "references": [
    {
      "path": "../../packages/diffs/tsconfig.json"
    }
  ]
}
```

在根 `tsconfig.json` 的 `references` 中加入：

```json
{
  "path": "apps/svelte-review-demo/tsconfig.json"
}
```

- [ ] **Step 3: 创建 Vite 配置**

创建 `apps/svelte-review-demo/vite.config.ts`：

```ts
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
});
```

- [ ] **Step 4: 创建入口文件**

创建 `apps/svelte-review-demo/index.html`：

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Svelte Review Diff Demo</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

创建 `apps/svelte-review-demo/src/main.ts`：

```ts
import { mount } from 'svelte';

import App from './App.svelte';
import './style.css';

mount(App, {
  target: document.querySelector('#app') as HTMLElement,
});
```

- [ ] **Step 5: 创建模拟数据**

创建 `apps/svelte-review-demo/src/reviewFiles.ts`，导出：

```ts
import type { ReviewDiffFile } from '@pierre/diffs/svelte/review';

export function createReviewFiles(seed: number): ReviewDiffFile[] {
  return [
    createTextFile(seed),
    createVirtualFile(seed),
    createStateFile(),
    createConflictFile(),
  ];
}
```

要求：

- `createTextFile` 覆盖 modified 文件，含完整 old/new。
- `createVirtualFile` 覆盖 partial patch，`canExpandContext: true`。
- `createStateFile` 覆盖 binary 或 read error。
- `createConflictFile` 覆盖 `kind: 'conflict'`。

同一个 seed 生成稳定 id，换 seed 改变内容但不改变顺序，用于验证同序
`updateItem`。

- [ ] **Step 6: 创建 App UI**

创建 `apps/svelte-review-demo/src/App.svelte`：

```svelte
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

  const files = $derived(createReviewFiles(seed));
  const notices = $derived([
    'Large files may be shown with limited context until expanded.',
  ]);

  const labels: ReviewDiffLabels = {
    ariaLabel: 'Review diff',
    collapseFile: 'Collapse file',
    expandFile: 'Expand file',
    noticeTitle: 'Notice',
    binaryFile: 'Binary file',
    symlinkFile: 'Symbolic link',
    invalidTextEncoding: 'Invalid text encoding',
    readError: 'Unable to read file',
    formatUnmodifiedLines: (count) => `${count} unchanged line${count > 1 ? 's' : ''}`,
  };

  function hydrateFile(fileId: string): void {
    const file = files.find((entry) => entry.id === fileId);
    if (file?.kind !== 'virtual') return;
    window.setTimeout(() => {
      reviewDiff?.hydrateFile(
        file.id,
        file.patch,
        'const before = true;\\n'.repeat(80),
        'const after = true;\\n'.repeat(80)
      );
    }, 250);
  }
</script>

<main class="review-demo">
  <header class="review-demo__toolbar" aria-label="Review controls">
    <button type="button" aria-pressed={wrap} onclick={() => (wrap = !wrap)}>Wrap</button>
    <button type="button" onclick={() => (diffStyle = diffStyle === 'split' ? 'unified' : 'split')}>
      {diffStyle === 'split' ? 'Split' : 'Unified'}
    </button>
    <button type="button" onclick={() => reviewDiff?.applyCollapseModeToLoaded(true)}>Collapse all</button>
    <button type="button" onclick={() => reviewDiff?.applyCollapseModeToLoaded(false)}>Expand all</button>
    <button type="button" onclick={() => (seed += 1)}>Regenerate</button>
  </header>

  <section class="review-demo__body">
    <ReviewDiff
      bind:this={reviewDiff}
      {files}
      {notices}
      {wrap}
      {collapsed}
      {diffStyle}
      {labels}
      onHydrationRequested={hydrateFile}
    />
  </section>
</main>
```

- [ ] **Step 7: 创建样式**

创建 `apps/svelte-review-demo/src/style.css`，使用克制工作台风格，不做营销页：

```css
html,
body,
#app {
  height: 100%;
  margin: 0;
}

body {
  background: #111318;
  color: #e5e7eb;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

button {
  border: 1px solid rgb(148 163 184 / 28%);
  border-radius: 6px;
  background: rgb(15 23 42 / 72%);
  color: inherit;
  min-height: 32px;
  padding: 0 10px;
}

.review-demo {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  height: 100%;
  min-width: 0;
}

.review-demo__toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid rgb(148 163 184 / 18%);
  background: #171a21;
}

.review-demo__body {
  min-height: 0;
  min-width: 0;
  padding: 12px;
}
```

- [ ] **Step 8: 运行应用验证**

Run:

```bash
bun run ws svelte-review-demo tsc
bun run ws svelte-review-demo build
```

Expected:

- 两个命令 PASS。

- [ ] **Step 9: 检查点，不提交**

Run:

```bash
git diff -- apps/svelte-review-demo tsconfig.json package.json bun.lock
git status --short
```

Expected:

- 不执行 `git commit`。

---

### Task 9: 浏览器验收和全量验证

**Files:**

- No direct file edits unless verification exposes defects.

- [ ] **Step 1: 启动演示应用**

Run:

```bash
bun run ws svelte-review-demo dev
```

Expected:

- Vite 打印本地 URL。保持进程运行，记住 session id。

- [ ] **Step 2: 用浏览器检查桌面布局**

用 Browser 打开 Vite URL，检查：

- 首屏就是差异区域，不是营销页。
- 顶部控制区不遮挡 diff 区域。
- diff 容器有边框、圆角、可滚动。
- split/unified 切换后内容不重叠。
- 点击未修改行区域会触发模拟 hydration，内容原地更新。

- [ ] **Step 3: 用浏览器检查窄屏布局**

把视口改为 `390x844`，检查：

- 工具栏按钮换行或压缩后不溢出。
- diff 容器仍可滚动。
- 没有文本重叠。

- [ ] **Step 4: 停掉开发服务器**

停止 Task 9 Step 1 的 Vite 进程。

如果是在 worktree 中执行，还需要按项目规则运行：

```bash
bun run wt clean
```

当前主目录执行时不需要 worktree cleanup。

- [ ] **Step 5: 运行核心验证**

Run:

```bash
bun run format
bun run lint
bun run ws diffs tsc
bun run ws diffs test
bun run ws svelte-review-demo tsc
bun run ws svelte-review-demo build
```

Expected:

- 全部 PASS。

- [ ] **Step 6: 最终检查点，不提交**

Run:

```bash
git status --short
git diff --stat
```

Expected:

- 工作区只包含本计划范围内的文件修改。
- 向用户汇报验证结果和本地演示 URL。
- 不执行 `git commit`。

---

## 自检

规格覆盖：

- 核心 patch 回流：Task 2、Task 3、Task 4。
- Svelte 高阶入口：Task 5、Task 6、Task 7。
- 演示页面：Task 8、Task 9。
- 测试和验证：每个任务有目标测试，Task 9 有全量验证。
- 迁移边界：计划没有引入 LoomDesk IPC、i18n、`@runloom/ui` 或 Git watch。

歧义处理：

- `formatUnmodifiedLines`
  不进入 Worker 消息。设计文档里提到 worker 参数时，实施中按可结构化复制约束修正为“主线程渲染参数”，因为该选项是函数，不能可靠传入 Worker。
- `iterateOverDiff`
  当前仓库已有类似修复，所以计划先补充 split/both 覆盖；只有测试失败才改实现。
- 用户要求不主动提交代码，因此所有 commit 步骤都改为检查点。

占位扫描：

- 本计划不使用占位项或未展开的实施说明。
- 所有新增依赖都有精确 catalog 版本。
- 所有验证命令都有预期结果。
