import './style.css';
import testContent from './tests/example.txt?raw';
import { createChunkedRenderer } from './createChunkedRenderer';

const renderToHTML = await createChunkedRenderer();
const LINES_PER_CHUNK = 50;
const DISABLE_CHUNKS = false;

const chunks = (() => {
  if (DISABLE_CHUNKS) {
    return [testContent];
  }
  const chunks: string[] = [];
  let currentChunk: string[] | null = null;
  for (const line of testContent.split('\n')) {
    const lineChunk = (() => {
      if (currentChunk == null || currentChunk.length < LINES_PER_CHUNK) {
        if (currentChunk == null) {
          currentChunk = [];
        }
        return currentChunk;
      }
      chunks.push(currentChunk.join('\n'));
      currentChunk = [];
      return currentChunk;
    })();
    lineChunk?.push(line);
  }
  if (currentChunk != null && currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
  }
  return chunks;
})();

let wrapper = document.getElementById('content');

const timings: number[] = [];
let hasRendered = false;
let currentLine = 0;
async function renderChunk(event: MouseEvent) {
  const chunk = chunks.shift();
  if (chunk == null || wrapper == null) return;
  const start = Date.now();
  const html = renderToHTML({
    lang: 'typescript',
    content: chunk,
    startingLine: currentLine,
    showLineNumbers: true,
  });
  currentLine += LINES_PER_CHUNK;
  if (!hasRendered) {
    wrapper.innerHTML = html;
    wrapper = wrapper.querySelector('[data-code]');
  } else {
    wrapper.insertAdjacentHTML('beforeend', html);
  }
  timings.push(Date.now() - start);
  hasRendered = true;
  if (chunks.length === 0 && event.currentTarget instanceof HTMLElement) {
    event.currentTarget.parentNode?.removeChild(event.currentTarget);
    console.log('ZZZZZ - chunk timings', timings);
  }
}

const toggleTheme = document.getElementById('toggle-theme');
if (toggleTheme != null) {
  toggleTheme.addEventListener('click', () => {
    const code = document.querySelector('[data-theme]');
    if (!(code instanceof HTMLElement)) return;
    code.dataset.theme = code.dataset.theme === 'light' ? 'dark' : 'light';
  });
}

const renderChunkElement = document.getElementById('render-chunk');
if (renderChunkElement != null) {
  renderChunkElement.addEventListener('click', renderChunk);
}
