import './style.css';
import testContent from './tests/example.txt?raw';
import testContent2 from './tests/example2.txt?raw';
import { createFakeContentStream } from './utils/fakeContentStream';
import { CodeRenderer } from './CodeRenderer';

async function startStreaming(event: MouseEvent) {
  const wrapper = document.getElementById('content');
  if (wrapper == null) return;
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.parentNode?.removeChild(event.currentTarget);
  }
  const instance = new CodeRenderer(createFakeContentStream(testContent), {
    lang: 'typescript',
    theme: 'tokyo-night',
    defaultColor: false,
  });

  instance.setup(wrapper);

  const instance2 = new CodeRenderer(createFakeContentStream(testContent2), {
    lang: 'markdown',
    themes: { dark: 'min-dark', light: 'min-light' },
    defaultColor: false,
  });
  instance2.setup(wrapper);
}

document.getElementById('toggle-theme')?.addEventListener('click', () => {
  const codes = document.querySelectorAll('[data-theme]');
  for (const code of codes) {
    if (!(code instanceof HTMLElement)) return;
    code.dataset.theme = code.dataset.theme === 'light' ? 'dark' : 'light';
  }
});

document
  .getElementById('stream-code')
  ?.addEventListener('click', startStreaming);
