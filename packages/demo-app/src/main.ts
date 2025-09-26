import {
  CodeRenderer,
  DiffRenderer,
  type ParsedPatch,
  isHighlighterNull,
  parsePatchContent,
  preloadHighlighter,
  renderFileHeader,
} from '@pierre/diff-ui';
import type { BundledLanguage, BundledTheme } from 'shiki';

import {
  CodeConfigs,
  DIFF_CONTENT,
  DIFF_DECORATIONS,
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
  parsedPatches = parsePatchContent(DIFF_CONTENT);
  console.log('Parsed File:', parsedPatches);
  const langs = new Set<BundledLanguage>();
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
function renderDiff() {
  const container = document.getElementById('content');
  if (container == null) return;
  if (loadDiff != null) {
    loadDiff.parentElement?.removeChild(loadDiff);
  }
  if (streamCode != null) {
    streamCode.parentElement?.removeChild(streamCode);
  }
  const checkbox = document.getElementById('unified') as
    | HTMLInputElement
    | undefined;
  container.dataset.diff = '';
  parsedPatches = parsedPatches ?? parsePatchContent(DIFF_CONTENT);
  const unified = checkbox?.checked ?? false;
  for (const parsedPatch of parsedPatches) {
    if (parsedPatch.patchMetadata != null) {
      container.appendChild(createFileMetadata(parsedPatch.patchMetadata));
    }
    for (const file of parsedPatch.files) {
      const decorations = DIFF_DECORATIONS[file.name];
      container.appendChild(renderFileHeader(file));
      const pre = document.createElement('pre');
      container.appendChild(pre);
      const instance = new DiffRenderer({
        lang: getFiletypeFromMetadata(file),
        themes: { dark: 'tokyo-night', light: 'solarized-light' },
        unified,
      });
      instance.render(file, pre, decorations);
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
  loadDiff.addEventListener('click', renderDiff);
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
