import './style.css';
import yamlContent from '../pnpm-lock.yaml?raw';
import { renderToHTML } from './renderHTML';

const start = performance.now();
const html = await renderToHTML({
  content: yamlContent,
  showLineNumbers: true,
});
console.log('ZZZZZ - totalTime', performance.now() - start);

const wrapper = document.getElementById('content');

if (wrapper != null) {
  wrapper.innerHTML = html;
}

const element = document.getElementById('toggle-theme');
if (element != null) {
  element.addEventListener('click', () => {
    const code = document.querySelector('[data-theme]');
    if (!(code instanceof HTMLElement)) return;
    code.dataset.theme = code.dataset.theme === 'light' ? 'dark' : 'light';
  });
}
