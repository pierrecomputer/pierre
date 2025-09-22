import type { BundledLanguage, BundledTheme } from 'shiki';
import './style.css';
import {
  CodeConfigs,
  DIFF_CONTENT,
  DIFF_DECORATIONS,
  getFiletypeFromMetadata,
  toggleTheme,
} from './test_files/';
import { createFakeContentStream } from './utils/createFakeContentStream';
import {
  CodeRenderer,
  DiffRenderer,
  isHighlighterNull,
  preloadHighlighter,
  parsePatchContent,
  type ParsedPatch,
} from 'pierrejs';

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

let parsedPatch: ParsedPatch | undefined;
function handlePreloadDiff() {
  if (parsedPatch != null || !isHighlighterNull()) return;
  parsedPatch = parsePatchContent(DIFF_CONTENT);
  console.log('Parsed File:', parsedPatch);
  const langs = new Set<BundledLanguage>();
  for (const file of parsedPatch.files) {
    const lang = getFiletypeFromMetadata(file);
    if (lang != null) {
      langs.add(lang);
    }
  }
  preloadHighlighter({
    langs: Array.from(langs),
    themes: ['tokyo-night', 'solarized-light'],
  });
}

function renderDiff() {
  const container = document.getElementById('content');
  if (container == null) return;
  if (loadDiff != null) {
    loadDiff.parentElement?.removeChild(loadDiff);
  }
  if (streamCode != null) {
    streamCode.parentElement?.removeChild(streamCode);
  }
  container.dataset.diff = '';
  parsedPatch = parsedPatch ?? parsePatchContent(DIFF_CONTENT);
  const unified =
    (document.getElementById('unified') as HTMLInputElement | undefined)
      ?.checked ?? false;
  for (const file of parsedPatch.files) {
    const decorations = DIFF_DECORATIONS[file.name];
    const pre = document.createElement('pre');
    container.appendChild(pre);
    const instance = new DiffRenderer({
      lang: getFiletypeFromMetadata(file),
      themes: { dark: 'tokyo-night', light: 'solarized-light' },
      unified,
    });
    instance.setup(file, pre, decorations);
  }
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
