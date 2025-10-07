import {
  CodeRenderer,
  DiffFileRenderer,
  type LineAnnotation,
  type ParsedPatch,
  type SupportedLanguages,
  getFiletypeFromFileName,
  isHighlighterNull,
  parseDiffFromFiles,
  parsePatchContent,
  preloadHighlighter,
} from '@pierre/diff-ui';
import type { BundledLanguage, BundledTheme } from 'shiki';

import { CodeConfigs, FILE_NEW, FILE_OLD, toggleTheme } from './mocks/';
import './style.css';
import { createFakeContentStream } from './utils/createFakeContentStream';

let loadingPatch: Promise<string> | undefined;
async function loadPatchContent() {
  loadingPatch =
    loadingPatch ??
    new Promise((resolve) => {
      import('./mocks/diff.patch?raw').then(({ default: content }) =>
        resolve(content)
      );
    });
  return loadingPatch;
}

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
    const pre = document.createElement('pre');
    container.appendChild(pre);
    const instance = new CodeRenderer(options);
    instance.setup(createFakeContentStream(content, letterByLetter), pre);
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
  preloadHighlighter({
    langs: Array.from(langs),
    themes: ['tokyo-night', 'solarized-light'],
  });
}

const fakeLineAnnotations: LineAnnotation<unknown>[][][] = [
  [
    [
      { lineNumber: 5, side: 'additions' },
      { lineNumber: 5, side: 'deletions' },
      { lineNumber: 4, side: 'additions' },
      { lineNumber: 9, side: 'additions' },
      { lineNumber: 11, side: 'deletions' },
      { lineNumber: 15, side: 'additions' },
      { lineNumber: 13, side: 'deletions' },
    ],
    [{ lineNumber: 5, side: 'additions' }],
  ],
];
const diffInstances: DiffFileRenderer[] = [];
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
  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      wrapper.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    const patchAnnotations = fakeLineAnnotations[patchIndex] ?? [];
    let hunkIndex = 0;
    for (const fileDiff of parsedPatch.files) {
      const fileAnnotations = patchAnnotations[hunkIndex];
      const instance = new DiffFileRenderer({
        themes: { dark: 'tokyo-night', light: 'solarized-light' },
        diffStyle: unified ? 'unified' : 'split',
        detectLanguage: true,
        overflow: wrap ? 'wrap' : 'scroll',
      });
      if (fileAnnotations != null) {
        instance.setLineAnnotations(fileAnnotations);
      }
      instance.render({ fileDiff, wrapper });
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
  const themes: BundledTheme[] = [];
  for (const item of CodeConfigs) {
    if ('lang' in item.options) {
      langs.push(item.options.lang);
    }
    if ('themes' in item.options) {
      themes.push(item.options.themes.dark);
      themes.push(item.options.themes.light);
    } else if ('theme' in item.options) {
      themes.push(item.options.theme);
    }
  }
  preloadHighlighter({ langs, themes });
}

document.getElementById('toggle-theme')?.addEventListener('click', toggleTheme);

const streamCode = document.getElementById('stream-code');
if (streamCode != null) {
  streamCode.addEventListener('click', startStreaming);
  streamCode.addEventListener('mouseenter', handlePreload);
}

const loadDiff = document.getElementById('load-diff');
if (loadDiff != null) {
  loadDiff.addEventListener('click', async () => {
    renderDiff(parsedPatches ?? parsePatchContent(await loadPatchContent()));
  });
  loadDiff.addEventListener('mouseenter', handlePreloadDiff);
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
      const parsed = parseDiffFromFiles(oldFile, newFile);
      for (const patch of parsed) {
        patch.patchMetadata = undefined;
      }
      renderDiff(parsed);
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
