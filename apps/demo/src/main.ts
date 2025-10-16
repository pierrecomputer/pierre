import {
  type BundledLanguage,
  CodeRenderer,
  FileDiff,
  type PJSThemeNames,
  type ParsedPatch,
  type SupportedLanguages,
  getFiletypeFromFileName,
  isHighlighterNull,
  parseDiffFromFile,
  parsePatchContent,
  preloadHighlighter,
} from '@pierre/diff-ui';

import {
  CodeConfigs,
  FAKE_LINE_ANNOTATIONS,
  FILE_NEW,
  FILE_OLD,
  type LineCommentMetadata,
} from './mocks/';
import './style.css';
import { createFakeContentStream } from './utils/createFakeContentStream';
import { renderAnnotation } from './utils/renderAnnotation';

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

const streamingInstances: CodeRenderer[] = [];
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
    const instance = new CodeRenderer(options);
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
  parsedPatches = parsePatchContent(content);
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
  const parentThemeSetting = document.documentElement.dataset.themeMode;
  const themeMode =
    parentThemeSetting === 'dark'
      ? 'dark'
      : parentThemeSetting === 'light'
        ? 'light'
        : 'system';

  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      wrapper.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    const patchAnnotations = FAKE_LINE_ANNOTATIONS[patchIndex] ?? [];
    let hunkIndex = 0;
    for (const fileDiff of parsedPatch.files) {
      const fileAnnotations = patchAnnotations[hunkIndex];
      const instance = new FileDiff<LineCommentMetadata>({
        themes: { dark: 'pierre-dark', light: 'pierre-light' },
        diffStyle: unified ? 'unified' : 'split',
        overflow: wrap ? 'wrap' : 'scroll',
        renderAnnotation,
        themeMode,
        onLineClick(props, diff) {
          console.log(diff.name, 'onLineClick', props);
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
      void instance.render({
        fileDiff,
        lineAnnotations: fileAnnotations,
        containerWrapper: wrapper,
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
  loadDiff.addEventListener('click', () => {
    void (async () => {
      renderDiff(parsedPatches ?? parsePatchContent(await loadPatchContent()));
    })();
  });
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
//
function toggleTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
  const pageTheme =
    (document.documentElement.dataset.themeMode ?? systemTheme) === 'dark'
      ? 'dark'
      : 'light';

  document.documentElement.dataset.themeMode =
    pageTheme === 'dark' ? 'light' : 'dark';

  for (const instance of diffInstances) {
    const themeSetting = instance.options.themeMode ?? 'system';
    const currentMode = themeSetting === 'system' ? pageTheme : themeSetting;
    instance.setThemeMode(currentMode === 'light' ? 'dark' : 'light');
  }

  for (const instance of streamingInstances) {
    const themeSetting = instance.options.themeMode ?? 'system';
    const currentMode = themeSetting === 'system' ? pageTheme : themeSetting;
    instance.setThemeMode(currentMode === 'light' ? 'dark' : 'light');
  }
}
