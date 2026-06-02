import type { ReviewDiffFile } from '@pierre/diffs/svelte/review';

const REVIEW_GROUPS = ['unstaged', 'staged', 'branch', 'committed'] as const;
const LARGE_FILE_LINE_COUNT = 1000;
const LARGE_FILE_CHANGE_STRIDE = 20;
const LARGE_FILE_CHANGE_BLOCK_SIZE = 2;
const STRESS_FILE_COUNT = 100;

export function createReviewFiles(seed: number): ReviewDiffFile[] {
  return [
    createTextFile(seed),
    createHugeTextFile(seed),
    createStateFile(),
    createConflictFile(seed),
    ...createStressVirtualFiles(seed, STRESS_FILE_COUNT),
  ];
}

function createTextFile(seed: number): ReviewDiffFile {
  const oldText = [
    'import { createPanel } from "./panel";',
    '',
    'export function createReviewPanel() {',
    '  return createPanel({',
    '    title: "Review",',
    '    refreshInterval: 0,',
    '    stale: false,',
    '  });',
    '}',
    '',
  ].join('\n');
  const newText = [
    'import { createPanel } from "./panel";',
    '',
    'export function createReviewPanel() {',
    '  return createPanel({',
    '    title: "Review",',
    `    refreshInterval: ${seed * 250},`,
    '    stale: false,',
    '    preserveScrollAnchor: true,',
    '  });',
    '}',
    '',
  ].join('\n');

  return {
    id: 'src/lib/project-tools/review/create-review-panel.ts',
    kind: 'text',
    path: 'src/lib/project-tools/review/create-review-panel.ts',
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    oldText,
    newText,
    byteSize: newText.length,
    lineCount: countLines(newText),
    patch: [
      'diff --git a/src/lib/project-tools/review/create-review-panel.ts b/src/lib/project-tools/review/create-review-panel.ts',
      'index 1111111..2222222 100644',
      '--- a/src/lib/project-tools/review/create-review-panel.ts',
      '+++ b/src/lib/project-tools/review/create-review-panel.ts',
      '@@ -3,8 +3,9 @@ export function createReviewPanel() {',
      '   return createPanel({',
      '     title: "Review",',
      '-    refreshInterval: 0,',
      `+    refreshInterval: ${seed * 250},`,
      '     stale: false,',
      '+    preserveScrollAnchor: true,',
      '   });',
      ' }',
      '',
    ].join('\n'),
  };
}

function createHugeTextFile(seed: number): ReviewDiffFile {
  const path =
    'src/lib/panel-kits/project-tools/review/review-diff-body-large.svelte';
  const oldText = createLargeReviewBodyText(seed, 'before');
  const newText = createLargeReviewBodyText(seed, 'after');

  return {
    id: path,
    kind: 'text',
    path,
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    oldText,
    newText,
    byteSize: newText.length,
    lineCount: countLines(newText),
    patch: '',
  };
}

function createStateFile(): ReviewDiffFile {
  return {
    id: 'assets/app-icon.png',
    kind: 'state',
    path: 'assets/app-icon.png',
    oldPath: null,
    status: 'binary',
    group: 'staged',
    reason: 'binary_file',
    byteSize: 148_224,
    message: null,
  };
}

function createConflictFile(seed: number): ReviewDiffFile {
  const oursText = [
    'export const reviewMode = {',
    '  scope: "uncommitted",',
    '  includeStaged: true,',
    '};',
    '',
  ].join('\n');
  const worktreeText = [
    'export const reviewMode = {',
    '  scope: "branch",',
    '  includeStaged: true,',
    `  seed: ${seed},`,
    '};',
    '',
  ].join('\n');

  return {
    id: 'src/lib/panel-kits/project-tools/review/review-options.ts',
    kind: 'conflict',
    path: 'src/lib/panel-kits/project-tools/review/review-options.ts',
    oldPath: null,
    status: 'conflicted',
    group: 'unstaged',
    baseText: 'export const reviewMode = {};\n',
    oursText,
    theirsText: null,
    worktreeText,
    patch: [
      'diff --git a/src/lib/panel-kits/project-tools/review/review-options.ts b/src/lib/panel-kits/project-tools/review/review-options.ts',
      'index 5555555..6666666 100644',
      '--- a/src/lib/panel-kits/project-tools/review/review-options.ts',
      '+++ b/src/lib/panel-kits/project-tools/review/review-options.ts',
      '@@ -1,5 +1,6 @@',
      ' export const reviewMode = {',
      '-  scope: "uncommitted",',
      '+  scope: "branch",',
      '   includeStaged: true,',
      `+  seed: ${seed},`,
      ' };',
      '',
    ].join('\n'),
    byteSize: worktreeText.length,
    lineCount: countLines(worktreeText),
  };
}

function createStressVirtualFiles(
  seed: number,
  count: number
): ReviewDiffFile[] {
  return Array.from({ length: count }, (_, index) =>
    createStressVirtualFile(seed, index)
  );
}

function createStressVirtualFile(seed: number, index: number): ReviewDiffFile {
  const ordinal = index + 1;
  const group = REVIEW_GROUPS[index % REVIEW_GROUPS.length];
  const path = `src/lib/panel-kits/project-tools/review/generated/review-file-${String(ordinal).padStart(3, '0')}.ts`;
  const patch = createVirtualPatch({
    path,
    seed,
    contextLines: 2,
    changePairs: 1,
    hunkContext: `function reviewFile${ordinal}()`,
    label: `review file ${ordinal}`,
  });

  return {
    id: path,
    kind: 'virtual',
    path,
    oldPath: null,
    status: 'modified',
    group,
    patch,
    byteSize: patch.length,
    lineCount: 3,
    contextLines: 2,
    canExpandContext: true,
  };
}

interface VirtualPatchOptions {
  changePairs: number;
  contextLines: number;
  hunkContext: string;
  label: string;
  path: string;
  seed: number;
}

function createLargeReviewBodyText(
  seed: number,
  variant: 'before' | 'after'
): string {
  return (
    Array.from({ length: LARGE_FILE_LINE_COUNT }, (_, index) => {
      const lineNumber = index + 1;
      const isChangedLine =
        (lineNumber - 1) % LARGE_FILE_CHANGE_STRIDE <
        LARGE_FILE_CHANGE_BLOCK_SIZE;
      const value = isChangedLine
        ? `${variant}-${seed}-${lineNumber}`
        : `shared-${seed}-${lineNumber}`;

      return `const largeReviewBodyLine${lineNumber} = ${JSON.stringify(value)};`;
    }).join('\n') + '\n'
  );
}

function createVirtualPatch({
  changePairs,
  contextLines,
  hunkContext,
  label,
  path,
  seed,
}: VirtualPatchOptions): string {
  const lineCount = contextLines + changePairs;
  const lines: string[] = [
    `diff --git a/${path} b/${path}`,
    'index 3333333..4444444 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${lineCount} +1,${lineCount} @@ ${hunkContext}`,
  ];

  for (let index = 0; index < contextLines; index++) {
    lines.push(` ${createContextLine(label, seed, index)}`);
  }
  for (let index = 0; index < changePairs; index++) {
    lines.push(`-${createDeletionLine(label, seed, index)}`);
    lines.push(`+${createAdditionLine(label, seed, index)}`);
  }
  lines.push('');

  return lines.join('\n');
}

function createContextLine(label: string, seed: number, index: number): string {
  return `const ${toIdentifier(label)}Context${index + 1} = ${JSON.stringify(`${label}-${seed}-${index + 1}`)};`;
}

function createDeletionLine(
  label: string,
  seed: number,
  index: number
): string {
  return `const ${toIdentifier(label)}Before${index + 1} = ${JSON.stringify(`before-${seed}-${index + 1}`)};`;
}

function createAdditionLine(
  label: string,
  seed: number,
  index: number
): string {
  return `const ${toIdentifier(label)}After${index + 1} = ${JSON.stringify(`after-${seed}-${index + 1}`)};`;
}

function toIdentifier(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`
    )
    .join('');
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.endsWith('\n')
    ? text.slice(0, -1).split('\n').length
    : text.split('\n').length;
}
