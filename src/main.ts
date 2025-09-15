import type { BundledLanguage, BundledTheme } from 'shiki';
import './style.css';
import { CodeConfigs, toggleTheme } from './test_files/';
import { createFakeContentStream } from './utils/createFakeContentStream';
import { CodeRenderer, isHighlighterNull, preloadHighlighter } from 'pierrejs';

async function startStreaming(event: MouseEvent) {
  const container = document.getElementById('content');
  if (container == null) return;
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.parentNode?.removeChild(event.currentTarget);
  }
  for (const { content, letterByLetter, options } of CodeConfigs) {
    const pre = document.createElement('pre');
    container.appendChild(pre);
    const instance = new CodeRenderer(options);
    instance.setup(createFakeContentStream(content, letterByLetter), pre);
  }
}

function handlePreload() {
  if (isHighlighterNull()) {
    const langs: BundledLanguage[] = [];
    const themes: BundledTheme[] = [];
    for (const item of CodeConfigs) {
      langs.push(item.options.lang);
      if ('themes' in item.options) {
        themes.push(item.options.themes.dark);
        themes.push(item.options.themes.light);
      } else if ('theme' in item.options) {
        themes.push(item.options.theme);
      }
    }
    preloadHighlighter({ langs, themes });
  }
}

document.getElementById('toggle-theme')?.addEventListener('click', toggleTheme);

const streamCode = document.getElementById('stream-code');
if (streamCode != null) {
  streamCode.addEventListener('click', startStreaming);
  streamCode.addEventListener('mouseenter', handlePreload);
}
