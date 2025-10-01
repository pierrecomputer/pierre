import {
  CodeRenderer,
  DiffRenderer,
  type ParsedPatch,
  type SupportedLanguages,
  isHighlighterNull,
  parseDiffFromFiles,
  parsePatchContent,
  preloadHighlighter,
  renderFileHeader,
} from '@pierre/diff-ui';
import type { BundledLanguage, BundledTheme } from 'shiki';

import {
  DIFF_CONTENT as CONTENT,
  CodeConfigs,
  FILE_NEW,
  FILE_OLD,
  getFiletypeFromMetadata,
  toggleTheme,
} from './mocks/';
import './style.css';
import { createFakeContentStream } from './utils/createFakeContentStream';

function startStreaming() {
  const container = document.getElementById('content');
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
function handlePreloadDiff() {
  if (parsedPatches != null || !isHighlighterNull()) return;
  parsedPatches = parsePatchContent(CONTENT);
  console.log('Parsed File:', parsedPatches);
  const langs = new Set<SupportedLanguages>();
  for (const parsedPatch of parsedPatches) {
    for (const file of parsedPatch.files) {
      const lang = getFiletypeFromMetadata(file);
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

const diffInstances: DiffRenderer[] = [];
function renderDiff(parsedPatches: ParsedPatch[]) {
  const container = document.getElementById('content');
  if (container == null) return;
  if (loadDiff != null) {
    loadDiff.parentElement?.removeChild(loadDiff);
  }
  if (streamCode != null) {
    streamCode.parentElement?.removeChild(streamCode);
  }
  container.innerHTML = '';
  window.scrollTo({ top: 0 });
  for (const instance of diffInstances) {
    instance.cleanUp();
  }
  diffInstances.length = 0;
  container.dataset.diff = '';

  const checkbox = document.getElementById('unified') as
    | HTMLInputElement
    | undefined;
  const unified = checkbox?.checked ?? false;
  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      container.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    for (const file of parsedPatch.files) {
      container.appendChild(renderFileHeader(file));
      const pre = document.createElement('pre');
      container.appendChild(pre);
      const instance = new DiffRenderer({
        lang: getFiletypeFromMetadata(file),
        themes: { dark: 'tokyo-night', light: 'solarized-light' },
        unified,
      });
      instance.render(file, pre);
      diffInstances.push(instance);
    }
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
  loadDiff.addEventListener('click', () =>
    renderDiff(parsedPatches ?? parsePatchContent(CONTENT))
  );
  loadDiff.addEventListener('mouseenter', handlePreloadDiff);
}

const wrapCheckbox = document.getElementById('wrap-lines');
if (wrapCheckbox != null) {
  wrapCheckbox.addEventListener('change', ({ currentTarget }) => {
    if (!(currentTarget instanceof HTMLInputElement)) {
      return;
    }
    const { checked } = currentTarget;
    const elements = document.querySelectorAll('[data-overflow]');
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (checked) {
        element.dataset.overflow = 'wrap';
      } else {
        element.dataset.overflow = 'scroll';
      }
    }
  });
}

const unifiedCheckbox = document.getElementById('unified');
if (unifiedCheckbox instanceof HTMLInputElement) {
  unifiedCheckbox.addEventListener('change', () => {
    const checked = unifiedCheckbox.checked;
    for (const instance of diffInstances) {
      instance.setOptions({ ...instance.options, unified: checked });
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

    const file1Container = document.createElement('div');
    file1Container.className = 'file';
    lastWrapper.className = 'files-input';
    const file1Name = document.createElement('input');
    file1Name.type = 'text';
    file1Name.value = 'file_old.ts';
    file1Name.spellcheck = false;
    const file1Contents = document.createElement('textarea');
    file1Contents.value = FILE_OLD;
    file1Contents.spellcheck = false;
    file1Container.appendChild(file1Name);
    file1Container.appendChild(file1Contents);
    lastWrapper.appendChild(file1Container);

    const file2Container = document.createElement('div');
    file2Container.className = 'file';
    lastWrapper.className = 'files-input';
    const file2Name = document.createElement('input');
    file2Name.type = 'text';
    file2Name.value = 'file_new.ts';
    file2Name.spellcheck = false;
    const file2Contents = document.createElement('textarea');
    file2Contents.value = FILE_NEW;
    file2Contents.spellcheck = false;
    file2Container.appendChild(file2Name);
    file2Container.appendChild(file2Contents);
    lastWrapper.appendChild(file2Container);

    const bottomWrapper = document.createElement('div');
    bottomWrapper.className = 'buttons';
    const render = document.createElement('button');
    render.innerText = 'Render Diff';
    render.addEventListener('click', () => {
      const oldFile = {
        name: file1Name.value,
        contents: file1Contents.value,
      };
      const newFile = {
        name: file2Name.value,
        contents: file2Contents.value,
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
