import {
  type BundledLanguage,
  File,
  FileDiff,
  FileStream,
  type PJSThemeNames,
  type ParsedPatch,
  type SupportedLanguages,
  getFiletypeFromFileName,
  isHighlighterNull,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
} from '@pierre/precision-diffs';

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
import {
  renderAnnotation,
  renderDiffAnnotation,
} from './utils/renderAnnotation';

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

const streamingInstances: FileStream[] = [];
function startStreaming() {
  const container = document.getElementById('wrapper');
  if (container == null) return;
  if (loadDiff != null) {
    loadDiff.parentElement?.removeChild(loadDiff);
  }
  if (streamCode != null) {
    streamCode.parentElement?.removeChild(streamCode);
  }
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
  if (parsedPatches != null || !isHighlighterNull()) return;
  const content = await loadPatchContent();
  parsedPatches = parsePatchFiles(content);
  console.log('Parsed File:', parsedPatches);
  const langs = new Set<SupportedLanguages>();
  for (const parsedPatch of parsedPatches) {
    for (const file of parsedPatch.files) {
      const lang = getFiletypeFromFileName(file.name);
      if (lang != null) {
        langs.add(lang);
      }
    }
  }
  void preloadHighlighter({
    langs: Array.from(langs),
    themes: ['tokyo-night', 'solarized-light'],
  });
}

const diffInstances: FileDiff<LineCommentMetadata>[] = [];
function renderDiff(parsedPatches: ParsedPatch[]) {
  const wrapper = document.getElementById('wrapper');
  if (wrapper == null) return;
  if (loadDiff != null) {
    loadDiff.parentElement?.removeChild(loadDiff);
  }
  if (streamCode != null) {
    streamCode.parentElement?.removeChild(streamCode);
  }
  wrapper.innerHTML = '';
  window.scrollTo({ top: 0 });
  for (const instance of diffInstances) {
    instance.cleanUp();
  }
  diffInstances.length = 0;
  wrapper.dataset.diff = '';

  const checkbox = document.getElementById('unified') as
    | HTMLInputElement
    | undefined;
  const unified = checkbox?.checked ?? false;
  const wrap =
    wrapCheckbox instanceof HTMLInputElement ? wrapCheckbox.checked : false;
  let patchIndex = 0;
  const parentThemeSetting = document.documentElement.dataset.themeType;
  const themeType =
    parentThemeSetting === 'dark'
      ? 'dark'
      : parentThemeSetting === 'light'
        ? 'light'
        : 'system';

  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      wrapper.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    const patchAnnotations = FAKE_DIFF_LINE_ANNOTATIONS[patchIndex] ?? [];
    let hunkIndex = 0;
    for (const fileDiff of parsedPatch.files) {
      const fileAnnotations = patchAnnotations[hunkIndex];
      const instance = new FileDiff<LineCommentMetadata>({
        themes: { dark: 'pierre-dark', light: 'pierre-light' },
        diffStyle: unified ? 'unified' : 'split',
        overflow: wrap ? 'wrap' : 'scroll',
        renderAnnotation: renderDiffAnnotation,
        themeType,
        // Custom Hunk Separators Tests
        // hunkSeparators(hunkData) {
        //   const fragment = document.createDocumentFragment();
        //   const numCol = document.createElement('div');
        //   numCol.textContent = `${hunkData.lines}`;
        //   numCol.style.position = 'sticky';
        //   numCol.style.left = '0';
        //   numCol.style.backgroundColor = 'var(--pjs-bg)';
        //   numCol.style.zIndex = '2';
        //   fragment.appendChild(numCol);
        //   const contentCol = document.createElement('div');
        //   contentCol.textContent = 'unmodified lines';
        //   contentCol.style.position = 'sticky';
        //   contentCol.style.width = 'var(--pjs-column-content-width)';
        //   contentCol.style.left = 'var(--pjs-column-number-width)';
        //   fragment.appendChild(contentCol);
        //   return fragment;
        // },
        // hunkSeparators(hunkData) {
        //   const wrapper = document.createElement('div');
        //   wrapper.style.gridColumn = 'span 2';
        //   const contentCol = document.createElement('div');
        //   contentCol.textContent = `${hunkData.lines} unmodified lines`;
        //   contentCol.style.position = 'sticky';
        //   contentCol.style.width = 'var(--pjs-column-width)';
        //   contentCol.style.left = '0';
        //   wrapper.appendChild(contentCol);
        //   return wrapper;
        // },
        // hunkSeparators(hunkData) {
        //   const wrapper = document.createElement('div');
        //   wrapper.style.gridColumn = '2 / 3';
        //   wrapper.textContent = `${hunkData.lines} unmodified lines`;
        //   wrapper.style.position = 'sticky';
        //   wrapper.style.width = 'var(--pjs-column-content-width)';
        //   wrapper.style.left = 'var(--pjs-column-number-width)';
        //   return wrapper;
        // },
        onLineClick(props) {
          console.log('onLineClick', props);
        },
        onLineNumberClick(props) {
          console.info('onLineNumberClick', props);
        },
        // Super noisy, but for debuggin
        // onLineEnter(props, diff) {
        //   console.log(
        //     diff.name,
        //     'onLineEnter',
        //     props.annotationSide,
        //     props.lineNumber
        //   );
        // },
        // onLineLeave(props, diff) {
        //   console.log(
        //     diff.name,
        //     'onLineLeave',
        //     props.annotationSide,
        //     props.lineNumber
        //   );
        // },
      });

      const fileContainer = document.createElement('file-diff');
      wrapper.appendChild(fileContainer);
      void instance.render({
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

function handlePreload() {
  if (!isHighlighterNull()) return;
  const langs: BundledLanguage[] = [];
  const themes: PJSThemeNames[] = [];
  for (const item of CodeConfigs) {
    if ('lang' in item.options) {
      langs.push(item.options.lang);
    }
    if ('themes' in item.options) {
      themes.push(item.options.themes.dark);
      themes.push(item.options.themes.light);
    }
  }
  void preloadHighlighter({ langs, themes });
}

document.getElementById('toggle-theme')?.addEventListener('click', toggleTheme);

const streamCode = document.getElementById('stream-code');
if (streamCode != null) {
  streamCode.addEventListener('click', startStreaming);
  streamCode.addEventListener('mouseenter', handlePreload);
}

const loadDiff = document.getElementById('load-diff');
if (loadDiff != null) {
  function handleClick() {
    void (async () => {
      renderDiff(parsedPatches ?? parsePatchFiles(await loadPatchContent()));
    })();
  }
  loadDiff.addEventListener('click', handleClick);
  loadDiff.addEventListener('mouseenter', () => void handlePreloadDiff);
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
      void instance.rerender();
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
      void instance.rerender();
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
      const oldFile = {
        name: fileOldName.value,
        contents: fileOldContents.value,
      };
      const newFile = {
        name: fileNewName.value,
        contents: fileNewContents.value,
      };

      lastWrapper?.parentNode?.removeChild(lastWrapper);
      const parsed = parseDiffFromFile(oldFile, newFile);
      renderDiff([{ files: [parsed] }]);
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

// For quick testing diffs
// (() => {
//   const oldFile = {
//     name: 'file_old.ts',
//     contents: FILE_OLD,
//   };
//   const newFile = {
//     name: 'file_new.ts',
//     contents: FILE_NEW,
//   };
//
//   const parsed = parseDiffFromFile(oldFile, newFile);
//   renderDiff([{ files: [parsed] }]);
// })();

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

const fileInstances: File<unknown>[] = [];
const renderFileButton = document.getElementById('render-file');
if (renderFileButton != null) {
  renderFileButton.addEventListener('click', () => {
    const wrapper = document.getElementById('wrapper');
    if (wrapper == null) return;
    const instance = new File<LineCommentMetadata>({
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
      renderAnnotation,
    });
    void instance.render({
      file: { name: 'main.tsx', contents: FILE_NEW },
      containerWrapper: wrapper,
      lineAnnotations: FAKE_LINE_ANNOTATIONS,
    });
    fileInstances.push(instance);
  });
}
