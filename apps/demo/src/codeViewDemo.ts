import {
  areSelectionsEqual,
  CodeView,
  type CodeViewDiffItem,
  type CodeViewItem,
  type CodeViewOptions,
  type DiffLineAnnotation,
  type DiffsThemeNames,
  type FileDiffContentsLoader,
  type LineAnnotation,
  type ParsedPatch,
  type SelectedLineRange,
  type ThemesType,
} from '@pierre/diffs';
import type { WorkerPoolManager } from '@pierre/diffs/worker';

import { FAKE_DIFF_LINE_ANNOTATIONS, type LineCommentMetadata } from './mocks/';
import { createHeaderFilenameSuffixBadge } from './utils/createHeaderFilenameSuffixBadge';

const RENDER_FILENAME_SUFFIX = false;

type CodeViewCommentMetadata =
  | CodeViewSavedCommentMetadata
  | CodeViewDraftCommentMetadata;

interface CodeViewSavedCommentMetadata extends LineCommentMetadata {
  kind: 'saved';
  key: string;
  itemId: string;
  range: SelectedLineRange;
}

interface CodeViewDraftCommentMetadata {
  kind: 'draft';
  key: string;
  itemId: string;
  message: string;
  range: SelectedLineRange;
}

interface CodeViewDemoInstance {
  instance: CodeView<CodeViewCommentMetadata>;
  options: CodeViewOptions<CodeViewCommentMetadata>;
}

type CodeViewDemoAnnotation =
  | DiffLineAnnotation<CodeViewCommentMetadata>
  | LineAnnotation<CodeViewCommentMetadata>;

type CodeViewDiffStyle = NonNullable<
  CodeViewOptions<CodeViewCommentMetadata>['diffStyle']
>;
type CodeViewOverflow = NonNullable<
  CodeViewOptions<CodeViewCommentMetadata>['overflow']
>;
type CodeViewThemeType = NonNullable<
  CodeViewOptions<CodeViewCommentMetadata>['themeType']
>;

interface RenderDemoCodeViewOptions {
  diffStyle: CodeViewDiffStyle;
  overflow: CodeViewOverflow;
  theme: DiffsThemeNames | ThemesType;
  themeType: CodeViewThemeType;
  loadDiffFiles?: FileDiffContentsLoader;
  workerManager?: WorkerPoolManager;
}

const codeViewInstances: CodeViewDemoInstance[] = [];
let nextCodeViewCommentKey = 0;

export function cleanupCodeView(container: HTMLElement) {
  for (const { instance } of codeViewInstances) {
    instance.cleanUp();
  }
  codeViewInstances.length = 0;
  delete container.dataset.codeView;
  setRootCodeViewState(container, false);
}

export function renderDemoCodeView(
  wrapper: HTMLElement,
  parsedPatches: ParsedPatch[],
  {
    diffStyle,
    overflow,
    theme,
    themeType,
    loadDiffFiles,
    workerManager,
  }: RenderDemoCodeViewOptions
) {
  setupCodeViewWrapper(wrapper);

  const items = createCodeViewItems(parsedPatches);
  const options: CodeViewOptions<CodeViewCommentMetadata> = {
    // __devOnlyValidateItemHeights: true,
    theme,
    themeType,
    diffStyle,
    overflow,
    loadDiffFiles,
    renderAnnotation(annotation) {
      return renderCodeViewAnnotation(annotation, viewer, items);
    },
    ...(RENDER_FILENAME_SUFFIX
      ? {
          renderHeaderFilenameSuffix() {
            return createHeaderFilenameSuffixBadge('CodeView slot');
          },
        }
      : null),
    lineHoverHighlight: 'both',
    expansionLineCount: 10,
    enableLineSelection: true,
    enableGutterUtility: true,
    stickyHeaders: true,
    layout: { paddingTop: 10, paddingBottom: 24, gap: 12 },
    onGutterUtilityClick(range, context) {
      if (context.item.type !== 'diff') {
        return;
      }
      createCodeViewDraftComment(viewer, items, context.item.id, range);
    },
    onSelectedLinesChange(selection) {
      console.log('CodeView selected lines', selection);
    },
  };

  const viewer = new CodeView(options, workerManager);
  viewer.setup(wrapper);
  viewer.setItems(items);
  codeViewInstances.push({ instance: viewer, options });
}

export function setCodeViewOverflow(overflow: CodeViewOverflow) {
  for (const codeView of codeViewInstances) {
    codeView.options = { ...codeView.options, overflow };
    codeView.instance.setOptions(codeView.options);
  }
}

export function setCodeViewDiffStyle(diffStyle: CodeViewDiffStyle) {
  for (const codeView of codeViewInstances) {
    codeView.options = { ...codeView.options, diffStyle };
    codeView.instance.setOptions(codeView.options);
  }
}

export function setCodeViewThemeType(themeType: CodeViewThemeType) {
  for (const codeView of codeViewInstances) {
    codeView.options = { ...codeView.options, themeType };
    codeView.instance.setOptions(codeView.options);
  }
}

function setupCodeViewWrapper(wrapper: HTMLElement) {
  wrapper.dataset.codeView = '';
  setRootCodeViewState(wrapper, true);
}

function setRootCodeViewState(element: HTMLElement, active: boolean) {
  const root = element.ownerDocument.getElementById('root');
  if (root == null) {
    return;
  }
  if (active) {
    root.dataset.codeView = '';
  } else {
    delete root.dataset.codeView;
  }
}

function createCodeViewItems(
  parsedPatches: ParsedPatch[]
): CodeViewItem<CodeViewCommentMetadata>[] {
  const items: CodeViewItem<CodeViewCommentMetadata>[] = [];
  for (let patchIndex = 0; patchIndex < parsedPatches.length; patchIndex++) {
    const parsedPatch = parsedPatches[patchIndex];
    if (parsedPatch == null) {
      continue;
    }
    const patchAnnotations = FAKE_DIFF_LINE_ANNOTATIONS[patchIndex] ?? [];
    for (let fileIndex = 0; fileIndex < parsedPatch.files.length; fileIndex++) {
      const fileDiff = parsedPatch.files[fileIndex];
      if (fileDiff == null) {
        continue;
      }
      const itemId = `diff:${patchIndex}:${fileIndex}:${fileDiff.name}`;
      const annotations = (patchAnnotations[fileIndex] ?? []).map(
        (annotation, annotationIndex) =>
          createCodeViewSavedAnnotation(
            annotation,
            itemId,
            `seed:${patchIndex}:${fileIndex}:${annotationIndex}`
          )
      );
      items.push({
        id: itemId,
        type: 'diff',
        fileDiff,
        annotations,
        version: 0,
      });
    }
  }
  return items;
}

function createCodeViewSavedAnnotation(
  annotation: DiffLineAnnotation<LineCommentMetadata>,
  itemId: string,
  key: string
): DiffLineAnnotation<CodeViewCommentMetadata> {
  return {
    side: annotation.side,
    lineNumber: annotation.lineNumber,
    metadata: {
      kind: 'saved',
      key,
      itemId,
      author: annotation.metadata.author,
      message: annotation.metadata.message,
      range: createCodeViewSelectionRange(
        annotation.lineNumber,
        annotation.side
      ),
    },
  };
}

function createCodeViewSelectionRange(
  lineNumber: number,
  side?: SelectedLineRange['side']
): SelectedLineRange {
  if (side == null) {
    return { start: lineNumber, end: lineNumber };
  }
  return { start: lineNumber, end: lineNumber, side, endSide: side };
}

function renderCodeViewAnnotation(
  annotation: CodeViewDemoAnnotation,
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[]
): HTMLElement | undefined {
  const { metadata } = annotation;
  if (metadata.kind === 'draft') {
    return createCodeViewDraftCommentElement(metadata, viewer, items);
  }
  return createCodeViewSavedCommentElement(annotation, viewer, items);
}

function createCodeViewSavedCommentElement(
  annotation: CodeViewDemoAnnotation,
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[]
) {
  const { metadata } = annotation;
  if (metadata.kind !== 'saved') {
    return undefined;
  }
  const side = 'side' in annotation ? annotation.side : 'line';
  const wrapper = document.createElement('div');
  wrapper.className = 'comment';
  wrapper.role = 'button';
  wrapper.tabIndex = 0;
  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.innerText = 'Delete';
  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removeCodeViewComment(viewer, items, metadata.itemId, metadata.key);
  });
  const author = document.createElement('h6');
  author.innerText = `${metadata.author}::(${side}-${annotation.lineNumber})`;
  const message = document.createElement('p');
  message.innerText = metadata.message;
  wrapper.appendChild(deleteButton);
  wrapper.appendChild(author);
  wrapper.appendChild(message);
  wrapper.addEventListener('click', () => {
    toggleCodeViewCommentSelection(viewer, metadata.itemId, metadata.range);
  });
  wrapper.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    toggleCodeViewCommentSelection(viewer, metadata.itemId, metadata.range);
  });
  return wrapper;
}

function createCodeViewDraftCommentElement(
  metadata: CodeViewDraftCommentMetadata,
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[]
) {
  const form = document.createElement('form');
  form.className = 'comment';
  const textarea = document.createElement('textarea');
  textarea.value = metadata.message;
  textarea.placeholder = 'Add a comment';
  textarea.rows = 2;
  textarea.spellcheck = false;
  textarea.style.boxSizing = 'border-box';
  textarea.style.marginBottom = '8px';
  textarea.style.resize = 'vertical';
  textarea.style.width = '100%';
  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.innerText = 'Cancel';
  const save = document.createElement('button');
  save.type = 'submit';
  save.innerText = 'Save comment';
  const updateSaveState = () => {
    save.disabled = textarea.value.trim().length === 0;
  };
  updateSaveState();
  textarea.addEventListener('input', updateSaveState);
  textarea.addEventListener('keydown', (event) => {
    if (!event.shiftKey || event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    saveCodeViewDraftComment(
      viewer,
      items,
      metadata.itemId,
      metadata.key,
      textarea.value
    );
  });
  cancel.addEventListener('click', () => {
    removeCodeViewComment(viewer, items, metadata.itemId, metadata.key);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveCodeViewDraftComment(
      viewer,
      items,
      metadata.itemId,
      metadata.key,
      textarea.value
    );
  });
  form.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  actions.appendChild(cancel);
  actions.appendChild(save);
  form.appendChild(textarea);
  form.appendChild(actions);
  return form;
}

function createCodeViewDraftComment(
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[],
  itemId: string,
  range: SelectedLineRange
) {
  const item = getCodeViewDiffItem(items, itemId);
  const side = range.endSide ?? range.side;
  if (item == null || side == null) {
    return;
  }
  const lineNumber = range.end;
  const key = `draft:${nextCodeViewCommentKey++}`;
  const commentRange: SelectedLineRange = { ...range, side, endSide: side };
  item.annotations = [
    ...(item.annotations ?? []),
    {
      side,
      lineNumber,
      metadata: {
        kind: 'draft',
        key,
        itemId,
        message: '',
        range: commentRange,
      },
    },
  ];
  publishCodeViewItemChange(viewer, items, item);
  viewer.setSelectedLines({ id: itemId, range: commentRange });
}

function saveCodeViewDraftComment(
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[],
  itemId: string,
  key: string,
  message: string
) {
  const trimmedMessage = message.trim();
  if (trimmedMessage.length === 0) {
    return;
  }
  const item = getCodeViewDiffItem(items, itemId);
  if (item?.annotations == null) {
    return;
  }
  let changed = false;
  item.annotations = item.annotations.map((annotation) => {
    if (
      annotation.metadata.kind !== 'draft' ||
      annotation.metadata.key !== key
    ) {
      return annotation;
    }
    changed = true;
    return {
      ...annotation,
      metadata: {
        kind: 'saved',
        key,
        itemId,
        author: 'You',
        message: trimmedMessage,
        range: annotation.metadata.range,
      },
    };
  });
  if (!changed) {
    return;
  }
  publishCodeViewItemChange(viewer, items, item);
  viewer.clearSelectedLines();
}

function removeCodeViewComment(
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[],
  itemId: string,
  key: string
) {
  const item = getCodeViewDiffItem(items, itemId);
  if (item?.annotations == null) {
    return;
  }
  const nextAnnotations = item.annotations.filter(
    (annotation) => annotation.metadata.key !== key
  );
  if (nextAnnotations.length === item.annotations.length) {
    return;
  }
  item.annotations = nextAnnotations;
  publishCodeViewItemChange(viewer, items, item);
  viewer.clearSelectedLines();
}

function getCodeViewDiffItem(
  items: CodeViewItem<CodeViewCommentMetadata>[],
  itemId: string
): CodeViewDiffItem<CodeViewCommentMetadata> | undefined {
  const item = items.find((candidate) => candidate.id === itemId);
  return item?.type === 'diff' ? item : undefined;
}

function publishCodeViewItemChange(
  viewer: CodeView<CodeViewCommentMetadata>,
  items: CodeViewItem<CodeViewCommentMetadata>[],
  item: CodeViewDiffItem<CodeViewCommentMetadata>
) {
  item.version = typeof item.version === 'number' ? item.version + 1 : 1;
  viewer.setItems([...items]);
}

function toggleCodeViewCommentSelection(
  viewer: CodeView<CodeViewCommentMetadata>,
  itemId: string,
  range: SelectedLineRange
) {
  const selection = viewer.getSelectedLines();
  if (selection?.id === itemId && areSelectionsEqual(selection.range, range)) {
    viewer.clearSelectedLines();
    return;
  }
  viewer.setSelectedLines({ id: itemId, range });
}
