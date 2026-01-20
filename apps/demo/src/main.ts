import {
  type BundledLanguage,
  DEFAULT_THEMES,
  DIFFS_TAG_NAME,
  type DiffsThemeNames,
  File,
  type FileContents,
  type FileDiff,
  FileStream,
  type ParsedPatch,
  SimpleVirtualizedFileDiff,
  SimpleVirtualizer,
  isHighlighterNull,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
} from '@pierre/diffs';
import type { WorkerPoolManager } from '@pierre/diffs/worker';

import {
  CodeConfigs,
  FAKE_DIFF_LINE_ANNOTATIONS,
  FAKE_LINE_ANNOTATIONS,
  FILE_NEW,
  FILE_OLD,
  type LineCommentMetadata,
} from './mocks/';
import './style.css';
import { createFakeContentStream } from './utils/createFakeContentStream';
import { createWorkerAPI } from './utils/createWorkerAPI';
import {
  renderAnnotation,
  renderDiffAnnotation,
} from './utils/renderAnnotation';

const diffInstances: FileDiff<LineCommentMetadata>[] = [];
const fileInstances: File<unknown>[] = [];
const streamingInstances: FileStream[] = [];

function cleanupInstances(container: HTMLElement) {
  for (const instance of diffInstances) {
    instance.cleanUp();
  }
  for (const instance of fileInstances) {
    instance.cleanUp();
  }
  for (const instance of streamingInstances) {
    instance.cleanUp();
  }
  diffInstances.length = 0;
  fileInstances.length = 0;
  streamingInstances.length = 0;
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

// Create worker API - helper handles worker creation automatically!
const poolManager = (() => {
  const manager = createWorkerAPI({
    theme: DEFAULT_THEMES,
    langs: ['typescript', 'tsx'],
  });
  void manager.initialize().then(() => {
    console.log('WorkerPoolManager initialized, with:', manager.getStats());
  });

  // @ts-expect-error bcuz
  window.__POOL = manager;
  return manager;
})();

const intersectionObserver = new SimpleVirtualizer();
// const intersectionObserver = undefined;

function startStreaming() {
  const container = document.getElementById('wrapper');
  if (container == null) return;
  cleanupInstances(container);
  for (const { content, letterByLetter, options } of CodeConfigs) {
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

  const checkbox = document.getElementById('unified') as
    | HTMLInputElement
    | undefined;
  const unified = checkbox?.checked ?? false;
  const wrap =
    wrapCheckbox instanceof HTMLInputElement ? wrapCheckbox.checked : false;
  let patchIndex = 0;
  const themeType = getThemeType();

  intersectionObserver.setup(globalThis.document);
  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      wrapper.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    const patchAnnotations = FAKE_DIFF_LINE_ANNOTATIONS[patchIndex] ?? [];
    let hunkIndex = 0;
    for (const fileDiff of parsedPatch.files) {
      const fileAnnotations = patchAnnotations[hunkIndex];
      const instance = new SimpleVirtualizedFileDiff<LineCommentMetadata>(
        {
          theme: { dark: 'pierre-dark', light: 'pierre-light' },
          diffStyle: unified ? 'unified' : 'split',
          overflow: wrap ? 'wrap' : 'scroll',
          renderAnnotation: renderDiffAnnotation,
          themeType,
          enableLineSelection: true,

          // Hover Decoration Snippets
          // enableHoverUtility: true,
          // renderHoverUtility(getHoveredLine) {
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
          onLineClick(props) {
            console.log('onLineClick', props);
          },
          onLineNumberClick(props) {
            console.info('onLineNumberClick', props);
          },
          // Super noisy, but for debuggin
          // onLineEnter(props) {
          //   console.log('onLineEnter', props.annotationSide, props.lineNumber);
          // },
          // onLineLeave(props) {
          //   console.log('onLineLeave', props.annotationSide, props.lineNumber);
          // },
          // __debugMouseEvents: 'click',
        },
        intersectionObserver,
        manager
      );

      const fileContainer = document.createElement(DIFFS_TAG_NAME);
      wrapper.appendChild(fileContainer);
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
  const langs: BundledLanguage[] = [];
  const themes: DiffsThemeNames[] = [];
  for (const item of CodeConfigs) {
    if ('lang' in item.options) {
      langs.push(item.options.lang);
    }
    if ('themes' in item.options) {
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
      // void instance.rerender();
    }
    for (const instance of fileInstances) {
      instance.setOptions({
        ...instance.options,
        overflow: checked ? 'wrap' : 'scroll',
      });
      // void instance.rerender();
    }
  });
}

const unifiedCheckbox = document.getElementById('unified');
if (unifiedCheckbox instanceof HTMLInputElement) {
  unifiedCheckbox.addEventListener('change', () => {
    const checked = unifiedCheckbox.checked;
    for (const instance of diffInstances) {
      instance.setOptions({
        ...instance.options,
        diffStyle: checked ? 'unified' : 'split',
      });
      // void instance.rerender();
    }
  });
}

let lastWrapper: HTMLElement | undefined;
const diff2Files = document.getElementById('diff-files');
if (diff2Files != null) {
  diff2Files.addEventListener('click', () => {
    if (lastWrapper != null) {
      lastWrapper.parentElement?.removeChild(lastWrapper);
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

      lastWrapper?.parentNode?.removeChild(lastWrapper);
      const parsed = parseDiffFromFile(oldFile, newFile);
      console.log('ZZZZZ - parsed', parsed);
      renderDiff([{ files: [parsed] }], poolManager);
    });
    bottomWrapper.appendChild(render);

    const cancel = document.createElement('button');
    cancel.innerText = 'Cancel';
    bottomWrapper.appendChild(cancel);

    cancel.addEventListener('click', () => {
      lastWrapper?.parentNode?.removeChild(lastWrapper);
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

  for (const instance of diffInstances) {
    const themeSetting = instance.options.themeType ?? 'system';
    const currentMode = themeSetting === 'system' ? pageTheme : themeSetting;
    instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
  }

  for (const instance of streamingInstances) {
    const themeSetting = instance.options.themeType ?? 'system';
    const currentMode = themeSetting === 'system' ? pageTheme : themeSetting;
    instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
  }

  for (const instance of fileInstances) {
    const themeSetting = instance.options.themeType ?? 'system';
    const currentMode = themeSetting === 'system' ? pageTheme : themeSetting;
    instance.setThemeType(currentMode === 'light' ? 'dark' : 'light');
  }
}

const fileExample: FileContents = {
  name: 'main.tsx',
  contents: FILE_NEW,
  cacheKey: 'file',
};
const renderFileButton = document.getElementById('render-file');
if (renderFileButton != null) {
  renderFileButton.addEventListener('click', () => {
    const wrapper = document.getElementById('wrapper');
    if (wrapper == null) return;
    cleanupInstances(wrapper);

    const fileContainer = document.createElement(DIFFS_TAG_NAME);
    wrapper.appendChild(fileContainer);
    const instance = new File<LineCommentMetadata>(
      {
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        themeType: getThemeType(),
        renderAnnotation,
        onLineClick(props) {
          console.log('onLineClick', props);
        },
        onLineNumberClick(props) {
          console.info('onLineNumberClick', props);
        },

        enableLineSelection: true,

        // Hover Decoration Snippets
        // enableHoverUtility: true,
        // renderHoverUtility(getHoveredLine) {
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
      },
      poolManager
    );

    void instance.render({
      file: fileExample,
      lineAnnotations: FAKE_LINE_ANNOTATIONS,
      fileContainer,
    });
    fileInstances.push(instance);
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
