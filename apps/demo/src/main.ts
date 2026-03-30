import {
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
  type DiffsThemeNames,
  File,
  type FileContents,
  FileDiff,
  type FileDiffOptions,
  type FileOptions,
  FileStream,
  type FileStreamOptions,
  isHighlighterNull,
  parseDiffFromFile,
  type ParsedPatch,
  parsePatchFiles,
  preloadHighlighter,
  type SupportedLanguages,
  type ThemesType,
  UnresolvedFile,
  VirtualizedFile,
  VirtualizedFileDiff,
  Virtualizer,
} from '@pierre/diffs';
import type { WorkerPoolManager } from '@pierre/diffs/worker';

import {
  FAKE_DIFF_LINE_ANNOTATIONS,
  FAKE_LINE_ANNOTATIONS,
  FILE_CONFLICT,
  FILE_NEW,
  FILE_OLD,
  type LineCommentMetadata,
} from './mocks/';
import './style.css';
import mdContent from './mocks/example_md.txt?raw';
import tsContent from './mocks/example_ts.txt?raw';
import { createFakeContentStream } from './utils/createFakeContentStream';
import { createHighlighterCleanup } from './utils/createHighlighterCleanup';
import { createWorkerAPI } from './utils/createWorkerAPI';
import {
  renderAnnotation,
  renderDiffAnnotation,
} from './utils/renderAnnotation';

const DEMO_THEME: DiffsThemeNames | ThemesType = DEFAULT_THEMES;
const WORKER_POOL = true;
const VIRTUALIZE = true;
const CRAZY_FILE = false;
const LARGE_CONFLICT_FILE = false;

const FileStreamCodeConfigs: FileStreamCodeConfigsItem[] = [
  {
    content: tsContent,
    letterByLetter: false,
    options: {
      lang: 'tsx',
      theme: DEMO_THEME,
      ...createHighlighterCleanup(),
    },
  },
  {
    content: mdContent,
    letterByLetter: true,
    options: {
      lang: 'markdown',
      theme: DEMO_THEME,
      ...createHighlighterCleanup(),
    },
  },
];

const diffInstances: (
  | FileDiff<LineCommentMetadata>
  | VirtualizedFileDiff<LineCommentMetadata>
)[] = [];
const fileInstances: File<LineCommentMetadata>[] = [];
const streamingInstances: FileStream[] = [];
const conflictInstances: UnresolvedFile<LineCommentMetadata>[] = [];

interface FileStreamCodeConfigsItem {
  content: string;
  letterByLetter: boolean;
  options: FileStreamOptions;
}

function cleanupInstances(container: HTMLElement) {
  for (const instances of [
    diffInstances,
    fileInstances,
    streamingInstances,
    conflictInstances,
  ]) {
    for (const instance of instances) {
      instance.cleanUp();
    }
    instances.length = 0;
  }
  container.innerHTML = '';
  delete container.dataset.diff;
}

let loadingPatch: Promise<string> | undefined;
async function loadPatchContent() {
  loadingPatch =
    loadingPatch ??
    new Promise((resolve) => {
      void import('./mocks/diff.patch?raw').then(({ default: content }) =>
        resolve(content)
      );
    });
  return loadingPatch;
}

let loadingLargeConflict: Promise<FileContents> | undefined;
async function loadLargeConflictFile(): Promise<FileContents> {
  loadingLargeConflict =
    loadingLargeConflict ??
    new Promise((resolve) => {
      void import('./mocks/fileConflictLarge.txt?raw').then(
        ({ default: contents }) =>
          resolve({
            name: 'fileConflictLarge.ts',
            contents,
            cacheKey: 'file-conflict-large',
          })
      );
    });
  return loadingLargeConflict;
}

// Create worker API - helper handles worker creation automatically!
const poolManager: WorkerPoolManager | undefined = WORKER_POOL
  ? (() => {
      const manager = createWorkerAPI({
        theme: DEMO_THEME,
        langs: ['typescript', 'tsx'],
        preferredHighlighter: 'shiki-wasm',
      });
      void manager.initialize().then(() => {
        console.log('WorkerPoolManager initialized, with:', manager.getStats());
      });

      // @ts-expect-error bcuz
      window.__POOL = manager;
      return manager;
    })()
  : undefined;

const virtualizer: Virtualizer | undefined = (() =>
  VIRTUALIZE ? new Virtualizer() : undefined)();

function startStreaming() {
  const container = document.getElementById('wrapper');
  if (container == null) return;
  cleanupInstances(container);
  for (const { content, letterByLetter, options } of FileStreamCodeConfigs) {
    const instance = new FileStream(options);
    void instance.setup(
      createFakeContentStream(content, letterByLetter),
      container
    );
    streamingInstances.push(instance);
  }
}

let parsedPatches: ParsedPatch[] | undefined;
async function handlePreloadDiff() {
  if (parsedPatches != null) return;
  const content = await loadPatchContent();
  parsedPatches = parsePatchFiles(content, 'parsed-patch');
  console.log('preloaded diff', parsedPatches);
}

function renderDiff(parsedPatches: ParsedPatch[], manager?: WorkerPoolManager) {
  console.log('renderDiff: rendering patches:', parsedPatches);
  const wrapper = document.getElementById('wrapper');
  if (wrapper == null) return;
  window.scrollTo({ top: 0 });
  cleanupInstances(wrapper);
  wrapper.dataset.diff = '';

  const unified = getUnified();
  const wrap = getWrapped();
  let patchIndex = 0;
  const themeType = getThemeType();

  virtualizer?.setup(globalThis.document);
  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      wrapper.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    const patchAnnotations = FAKE_DIFF_LINE_ANNOTATIONS[patchIndex] ?? [];
    let hunkIndex = 0;
    for (const fileDiff of parsedPatch.files) {
      const fileAnnotations = patchAnnotations[hunkIndex];
      let instance:
        | FileDiff<LineCommentMetadata>
        | VirtualizedFileDiff<LineCommentMetadata>;
      const options: FileDiffOptions<LineCommentMetadata> = {
        theme: DEMO_THEME,
        themeType,
        diffStyle: unified ? 'unified' : 'split',
        overflow: wrap ? 'wrap' : 'scroll',
        renderAnnotation: renderDiffAnnotation,
        renderHeaderMetadata() {
          return createCollapsedToggle(
            instance?.options.collapsed ?? false,
            (checked) => {
              instance?.setOptions({
                ...instance.options,
                collapsed: checked,
              });
              if (!VIRTUALIZE) {
                void instance.rerender();
              }
            }
          );
        },
        lineHoverHighlight: 'both',
        expansionLineCount: 10,
        // expandUnchanged: true,

        // Hover Decoration Snippets
        enableGutterUtility: true,
        // onGutterUtilityClick(event) {
        //   console.log('onGutterUtilityClick', event);
        // },
        // renderGutterUtility(getHoveredLine) {
        //   const el = document.createElement('div');
        //   el.style.width = '20px';
        //   el.style.height = '20px';
        //   el.style.backgroundColor = 'blue';
        //   el.style.borderRadius = '2px';
        //   el.style.marginRight = '-10px';
        //   el.style.textAlign = 'center';
        //   el.style.color = 'white';
        //   el.innerText = '+';
        //   el.addEventListener('click', (event) => {
        //     event.stopPropagation();
        //     console.log('ZZZZ - clicked', getHoveredLine());
        //   });
        //   el.addEventListener('pointerdown', (event) => {
        //     event.stopPropagation();
        //   });
        //   return el;
        // },

        // Custom Hunk Separators Tests with expansion properties
        // expansionLineCount: 10,
        // hunkSeparators(hunkData, instance) {
        //   const fragment = document.createDocumentFragment();
        //   const numCol = document.createElement('div');
        //   numCol.textContent = `${hunkData.lines}`;
        //   numCol.style.position = 'sticky';
        //   numCol.style.left = '0';
        //   numCol.style.backgroundColor = 'blue';
        //   numCol.style.zIndex = '2';
        //   numCol.style.color = 'white';
        //   fragment.appendChild(numCol);
        //   const contentCol = document.createElement('div');
        //   contentCol.textContent = 'unmodified lines';
        //   contentCol.style.position = 'sticky';
        //   contentCol.style.width = 'var(--diffs-column-content-width)';
        //   contentCol.style.left = 'var(--diffs-column-number-width)';
        //   contentCol.style.backgroundColor = 'blue';
        //   contentCol.style.color = 'white';
        //   fragment.appendChild(contentCol);
        //   const { expandable } = hunkData;
        //   if (expandable != null) {
        //     if (expandable.up && expandable.down && !expandable.chunked) {
        //       const button = document.createElement('button');
        //       button.innerText = 'both';
        //       button.addEventListener('click', () => {
        //         instance.expandHunk(hunkData.hunkIndex, 'both');
        //       });
        //       contentCol.appendChild(button);
        //     } else {
        //       if (expandable.up) {
        //         const button = document.createElement('button');
        //         button.innerText = '^';
        //         button.addEventListener('click', () => {
        //           instance.expandHunk(hunkData.hunkIndex, 'up');
        //         });
        //         contentCol.appendChild(button);
        //       }
        //       if (expandable.down) {
        //         const button = document.createElement('button');
        //         button.innerText = 'v';
        //         button.addEventListener('click', () => {
        //           instance.expandHunk(hunkData.hunkIndex, 'down');
        //         });
        //         contentCol.appendChild(button);
        //       }
        //     }
        //   }
        //   return fragment;
        // },
        // hunkSeparators(hunkData) {
        //   const wrapper = document.createElement('div');
        //   wrapper.style.gridColumn = 'span 2';
        //   const contentCol = document.createElement('div');
        //   contentCol.textContent = `${hunkData.lines} unmodified lines`;
        //   contentCol.style.position = 'sticky';
        //   contentCol.style.width = 'var(--diffs-column-width)';
        //   contentCol.style.left = '0';
        //   wrapper.appendChild(contentCol);
        //   return wrapper;
        // },
        // hunkSeparators(hunkData) {
        //   const wrapper = document.createElement('div');
        //   wrapper.style.gridColumn = '2 / 3';
        //   wrapper.textContent = `${hunkData.lines} unmodified lines`;
        //   wrapper.style.position = 'sticky';
        //   wrapper.style.width = 'var(--diffs-column-content-width)';
        //   wrapper.style.left = 'var(--diffs-column-number-width)';
        //   return wrapper;
        // },

        // Line selection stuff
        enableLineSelection: true,
        // onLineClick(props) {
        //   console.log('onLineClick', props);
        // },
        // onLineNumberClick(props) {
        //   console.info('onLineNumberClick', props);
        // },
        // onLineSelected(props) {
        //   console.log('onLineSelected', props);
        // },
        // onLineSelectionStart(props) {
        //   console.log('onLineSelectionStart', props);
        // },
        // onLineSelectionChange(props) {
        //   console.log('onLineSelectionChange', props);
        // },
        // onLineSelectionEnd(props) {
        //   console.log('onLineSelectionEnd', props);
        // },
        // Super noisy, but for debuggin
        // onLineEnter(props) {
        //   console.log('onLineEnter', props);
        // },
        // onLineLeave(props) {
        //   console.log('onLineLeave', props);
        // },
        // __debugMouseEvents: 'click',
      };
      instance = (() => {
        if (virtualizer != null) {
          return new VirtualizedFileDiff<LineCommentMetadata>(
            options,
            virtualizer,
            undefined,
            manager
          );
        } else {
          return new FileDiff<LineCommentMetadata>(options, manager);
        }
      })();

      const fileContainer = document.createElement(DIFFS_TAG_NAME);
      wrapper.appendChild(fileContainer);
      // This is weird...
      instance.render({
        fileDiff,
        lineAnnotations: fileAnnotations,
        fileContainer,
      });
      diffInstances.push(instance);
      hunkIndex++;
    }
    patchIndex++;
  }
  // window.scrollTo({ top: 70747 });
}

function createFileMetadata(patchMetadata: string) {
  const metadata = document.createElement('div');
  metadata.dataset.commitMetadata = '';
  metadata.innerText = patchMetadata.replace(/\n+$/, '');
  return metadata;
}

const workerInstances: Promise<unknown>[] = [];
// FIXME(amadeus): Don't export this, lawl
export function workerRenderDiff(parsedPatches: ParsedPatch[]) {
  workerInstances.length = 0;

  console.log('Worker Render: Starting to async render patch');
  for (const parsedPatch of parsedPatches) {
    for (const fileDiff of parsedPatch.files) {
      const start = Date.now();
      poolManager?.highlightDiffAST(
        {
          __id: 'hack',
          onHighlightSuccess(_diff, { code }) {
            console.log(
              'Worker Render: rendered file:',
              fileDiff.name,
              'lines:',
              code.additionLines.length + code.deletionLines.length,
              'time:',
              Date.now() - start
            );
          },
          onHighlightError(error: unknown) {
            console.error(error);
          },
        },
        fileDiff
      );
    }
  }
}

function handlePreload() {
  if (!isHighlighterNull()) return;
  const langs: SupportedLanguages[] = [];
  const themes: DiffsThemeNames[] = [];
  for (const item of FileStreamCodeConfigs) {
    if (item.options.lang != null) {
      langs.push(item.options.lang);
    }
    if (item.options.theme == null) {
      continue;
    } else if (typeof item.options.theme === 'string') {
      themes.push(item.options.theme);
    } else {
      themes.push(item.options.theme.dark);
      themes.push(item.options.theme.light);
    }
  }
  void preloadHighlighter({ langs, themes });
}

document.getElementById('toggle-theme')?.addEventListener('click', toggleTheme);

const streamCode = document.getElementById('stream-code');
if (streamCode != null) {
  streamCode.addEventListener('click', startStreaming);
  streamCode.addEventListener('pointerenter', handlePreload);
}

const loadDiff = document.getElementById('load-diff');
if (loadDiff != null) {
  function handleClick() {
    void (async () => {
      parsedPatches ??= parsePatchFiles(
        await loadPatchContent(),
        'parsed-patch'
      );
      renderDiff(parsedPatches, poolManager);
      // window.scrollTo({ top: 99999999999 });
    })();
  }

  // void poolManager.initialize().then(() => handleClick());
  loadDiff.addEventListener('click', handleClick);
  loadDiff.addEventListener('pointerenter', () => void handlePreloadDiff());
}

const wrapCheckbox = document.getElementById('wrap-lines');
function getWrapped(): boolean {
  return wrapCheckbox instanceof HTMLInputElement
    ? wrapCheckbox.checked
    : false;
}
if (wrapCheckbox != null) {
  wrapCheckbox.addEventListener('change', ({ currentTarget }) => {
    if (!(currentTarget instanceof HTMLInputElement)) {
      return;
    }
    const { checked } = currentTarget;
    for (const instance of diffInstances) {
      instance.setOptions({
        ...instance.options,
        overflow: checked ? 'wrap' : 'scroll',
      });
      if (!VIRTUALIZE) {
        void instance.rerender();
      }
    }
    for (const instance of fileInstances) {
      instance.setOptions({
        ...instance.options,
        overflow: checked ? 'wrap' : 'scroll',
      });
      void instance.rerender();
    }
  });
}

const unifiedCheckbox = document.getElementById('unified');
function getUnified(): boolean {
  return unifiedCheckbox instanceof HTMLInputElement
    ? unifiedCheckbox.checked
    : false;
}
if (unifiedCheckbox instanceof HTMLInputElement) {
  unifiedCheckbox.addEventListener('change', () => {
    const checked = unifiedCheckbox.checked;
    for (const instance of diffInstances) {
      instance.setOptions({
        ...instance.options,
        diffStyle: checked ? 'unified' : 'split',
      });
      if (!VIRTUALIZE) {
        void instance.rerender();
      }
    }
  });
}

let lastWrapper: HTMLElement | undefined;
const diff2Files = document.getElementById('diff-files');
if (diff2Files != null) {
  diff2Files.addEventListener('click', () => {
    if (lastWrapper != null) {
      lastWrapper.remove();
    }
    lastWrapper = document.createElement('div');

    const fileOldContainer = document.createElement('div');
    fileOldContainer.className = 'file';
    lastWrapper.className = 'files-input';
    const fileOldName = document.createElement('input');
    fileOldName.type = 'text';
    fileOldName.value = 'file_old.ts';
    fileOldName.spellcheck = false;
    const fileOldContents = document.createElement('textarea');
    fileOldContents.value = FILE_OLD;
    fileOldContents.spellcheck = false;
    fileOldContainer.appendChild(fileOldName);
    fileOldContainer.appendChild(fileOldContents);
    lastWrapper.appendChild(fileOldContainer);

    const fileNewContainer = document.createElement('div');
    fileNewContainer.className = 'file';
    lastWrapper.className = 'files-input';
    const fileNewName = document.createElement('input');
    fileNewName.type = 'text';
    fileNewName.value = 'file_new.ts';
    fileNewName.spellcheck = false;
    const fileNewContents = document.createElement('textarea');
    fileNewContents.value = FILE_NEW;
    fileNewContents.spellcheck = false;
    fileNewContainer.appendChild(fileNewName);
    fileNewContainer.appendChild(fileNewContents);
    lastWrapper.appendChild(fileNewContainer);

    const bottomWrapper = document.createElement('div');
    bottomWrapper.className = 'buttons';
    const render = document.createElement('button');
    render.innerText = 'Render Diff';
    render.addEventListener('click', () => {
      const oldFile: FileContents = {
        name: fileOldName.value,
        contents: fileOldContents.value,
        cacheKey: `old-${fileOldContents.value}`,
      };
      const newFile = {
        name: fileNewName.value,
        contents: fileNewContents.value,
        cacheKey: `new-${fileNewContents.value}`,
      };

      lastWrapper?.remove();
      const parsed = parseDiffFromFile(oldFile, newFile);
      console.log('ZZZZZ - parsed', parsed);
      renderDiff([{ files: [parsed] }], poolManager);
    });
    bottomWrapper.appendChild(render);

    const cancel = document.createElement('button');
    cancel.innerText = 'Cancel';
    bottomWrapper.appendChild(cancel);

    cancel.addEventListener('click', () => {
      lastWrapper?.remove();
    });

    lastWrapper.append(bottomWrapper);

    document.body.appendChild(lastWrapper);
  });
}

function toggleTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
  const pageTheme =
    (document.documentElement.dataset.themeType ?? systemTheme) === 'dark'
      ? 'dark'
      : 'light';

  document.documentElement.dataset.themeType =
    pageTheme === 'dark' ? 'light' : 'dark';

  for (const instances of [
    diffInstances,
    fileInstances,
    streamingInstances,
    conflictInstances,
  ]) {
    for (const instance of instances) {
      const themeSetting = instance.options.themeType ?? 'system';
      const currentMode = themeSetting === 'system' ? pageTheme : themeSetting;
      instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
    }
  }
}

const fileExample: FileContents | Promise<FileContents> = (() => {
  if (CRAZY_FILE) {
    return new Promise<FileContents>((resolve) => {
      void import('../../../bun.lock?raw').then(({ default: contents }) =>
        resolve({
          name: 'file.json',
          contents,
          cacheKey: 'diff',
        })
      );
    });
  }
  return {
    name: 'main.tsx',
    contents: FILE_NEW,
    cacheKey: 'file',
  };
})();

const fileConflict: FileContents = {
  name: 'file.ts',
  contents: FILE_CONFLICT,
};

const renderFileButton = document.getElementById('render-file');
if (renderFileButton != null) {
  // oxlint-disable-next-line @typescript-oxlint/no-misused-promises
  renderFileButton.addEventListener('click', async () => {
    const file = await fileExample;
    const wrapper = document.getElementById('wrapper');
    if (wrapper == null) return;
    cleanupInstances(wrapper);

    virtualizer?.setup(globalThis.document);
    const wrap = getWrapped();
    const fileContainer = document.createElement(DIFFS_TAG_NAME);
    wrapper.appendChild(fileContainer);
    let instance:
      | File<LineCommentMetadata>
      | VirtualizedFile<LineCommentMetadata>;
    const options: FileOptions<LineCommentMetadata> = {
      overflow: wrap ? 'wrap' : 'scroll',
      theme: DEMO_THEME,
      themeType: getThemeType(),
      renderAnnotation,
      renderCustomMetadata() {
        return createCollapsedToggle(
          instance?.options.collapsed ?? false,
          (checked) => {
            instance?.setOptions({
              ...instance.options,
              collapsed: checked,
            });
            if (!VIRTUALIZE) {
              void instance.rerender();
            }
          }
        );
      },

      // Line selection stuff
      enableLineSelection: true,
      // onLineClick(props) {
      //   console.log('onLineClick', props);
      // },
      // onLineNumberClick(props) {
      //   console.info('onLineNumberClick', props);
      // },
      // onLineSelected(props) {
      //   console.log('onLineSelected', props);
      // },
      // onLineSelectionStart(props) {
      //   console.log('onLineSelectionStart', props);
      // },
      // onLineSelectionChange(props) {
      //   console.log('onLineSelectionChange', props);
      // },
      // onLineSelectionEnd(props) {
      //   console.log('onLineSelectionEnd', props);
      // },
      // Super noisy, but for debuggin
      // onLineEnter(props) {
      //   console.log('onLineEnter', props);
      // },
      // onLineLeave(props) {
      //   console.log('onLineLeave', props);
      // },

      // Hover Decoration Snippets
      enableGutterUtility: true,
      // onGutterUtilityClick(event) {
      //   console.log('onGutterUtilityClick', event);
      // },
      // renderGutterUtility(getHoveredLine) {
      //   const el = document.createElement('div');
      //   el.style.width = '20px';
      //   el.style.height = '20px';
      //   el.style.backgroundColor = 'blue';
      //   el.style.borderRadius = '2px';
      //   el.style.marginRight = '-10px';
      //   el.style.textAlign = 'center';
      //   el.style.color = 'white';
      //   el.innerText = '+';
      //   el.addEventListener('click', (event) => {
      //     event.stopPropagation();
      //     console.log('ZZZZ - clicked', getHoveredLine());
      //   });
      //   el.addEventListener('mousedown', (event) => {
      //     event.stopPropagation();
      //   });
      //   return el;
      // },
    };

    instance = (() => {
      if (virtualizer != null) {
        return new VirtualizedFile<LineCommentMetadata>(
          options,
          virtualizer,
          undefined,
          poolManager
        );
      } else {
        return new File<LineCommentMetadata>(options, poolManager);
      }
    })();
    instance.render({
      file,
      lineAnnotations: FAKE_LINE_ANNOTATIONS,
      fileContainer,
    });
    fileInstances.push(instance);
  });
}

const renderFileConflictButton = document.getElementById('render-conflict');
if (renderFileConflictButton != null) {
  // oxlint-disable-next-line @typescript-oxlint/no-misused-promises
  renderFileConflictButton.addEventListener('click', async () => {
    const wrapper = document.getElementById('wrapper');
    if (wrapper == null) {
      return;
    }
    cleanupInstances(wrapper);
    const wrap = getWrapped();
    const fileContainer = document.createElement(DIFFS_TAG_NAME);
    wrapper.appendChild(fileContainer);
    const instance = new UnresolvedFile<LineCommentMetadata>(
      {
        theme: DEMO_THEME,
        themeType: getThemeType(),
        overflow: wrap ? 'wrap' : 'scroll',
        renderAnnotation,
        enableLineSelection: true,
        enableGutterUtility: true,
        maxContextLines: 4,
      },
      poolManager
    );
    const file = LARGE_CONFLICT_FILE
      ? await loadLargeConflictFile()
      : fileConflict;
    instance.render({
      file,
      // lineAnnotations: FAKE_DIFF_LINE_ANNOTATIONS[0][0],
      fileContainer,
    });
    conflictInstances.push(instance);
  });
}

const workerRenderButton = document.getElementById('worker-load-diff');
workerRenderButton?.addEventListener('click', () => {
  void (async () => {
    const patches = parsePatchFiles(await loadPatchContent(), 'parsed-patch');
    workerRenderDiff(patches);
  })();
});

function getThemeType() {
  const parentThemeSetting = document.documentElement.dataset.themeType;
  return parentThemeSetting === 'dark'
    ? 'dark'
    : parentThemeSetting === 'light'
      ? 'light'
      : 'system';
}

const cleanButton = document.getElementById('clean');
cleanButton?.addEventListener('click', () => {
  const container = document.getElementById('wrapper');
  if (container == null) {
    return;
  }
  cleanupInstances(container);
});

function createCollapsedToggle(
  checked: boolean,
  onChange: (checked: boolean) => void
): HTMLElement {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => {
    onChange(input.checked);
  });
  label.dataset.collapser = '';
  label.appendChild(input);
  label.append(' Collapse');
  return label;
}

// For quick testing diffs
// FAKE_DIFF_LINE_ANNOTATIONS.length = 0;
// (() => {
//   const oldFile = {
//     name: 'file_old.ts',
//     contents: FILE_OLD,
//   };
//   const newFile = {
//     name: 'file_new.ts',
//     contents: FILE_NEW,
//   };
//   const parsed = parseDiffFromFile(oldFile, newFile);
//   renderDiff([{ files: [parsed] }], poolManager);
// })();
