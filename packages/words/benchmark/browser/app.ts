import {
  createElement,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { createRoot } from 'react-dom/client';

import { createStressFixture } from '../fixtures/index.ts';
import './app.css';

export interface RendererProps {
  value: string;
  active: boolean;
  highlight: boolean;
  animated: boolean;
}

export interface ReplayResult {
  updates: number[];
  frames: number[];
  paragraphs: number;
  fences: number;
  highlightedFences: number;
  textHash: string;
  elements: number;
  errors: string[];
}

const params = new URLSearchParams(location.search);
const scale = Number(params.get('scale'));
const mode = params.get('mode');
const interval = Number(params.get('interval'));
const highlight = mode !== 'plain';
const animated = mode === 'animated';
const source = createStressFixture(scale);
const chunk = 32 * scale;
// Distinct from the fixture, so grammar and lazy modules load without seeding code caches.
const warmupSource =
  'Warmup **formatting**, *emphasis*, and [navigation](/warmup).\n\n' +
  '```typescript\nconst warmup: number = 1;\n```\n';
const errors: string[] = [];
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) =>
  errors.push(String(event.reason))
);
const updates: number[] = [];
const frames: number[] = [];
let requested = 0;
let completed = 0;
let markReady!: () => void;
let play!: (done: (result: ReplayResult) => void) => void;
Object.assign(window, {
  bench: {
    ready: new Promise<void>((resolve) => (markReady = resolve)),
    run: () => new Promise<ReplayResult>((resolve) => play(resolve)),
  },
});

/**
 * Commit-paced replay: warm up on a different document, remount an empty
 * renderer, then deliver `32 × scale` characters `interval` ms after each
 * commit. Update latency runs from the state request to this parent's layout
 * effect, after both renderers have written their DOM.
 */
export function mount(
  Renderer: (props: RendererProps) => ReactElement,
  pending: () => number = () => 0
): void {
  let done: (result: ReplayResult) => void;
  function App() {
    const [stage, setStage] = useState<'warmup' | 'idle' | 'playing'>('warmup');
    const [cursor, setCursor] = useState(0);
    useEffect(() => {
      play = (resolve) => {
        done = resolve;
        let previous = performance.now();
        const frame = (now: number) => {
          if (completed !== 0) return;
          frames.push(Math.round((now - previous) * 10) / 10);
          previous = now;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        setStage('playing');
      };
      // Streamdown loads its highlighted body lazily; wait for it as well.
      const start = performance.now();
      const timer = setInterval(() => {
        if (pending() !== 0 || performance.now() - start < 750) return;
        clearInterval(timer);
        setStage('idle');
      }, 30);
      return () => clearInterval(timer);
    }, []);
    useLayoutEffect(() => {
      if (stage === 'idle')
        requestAnimationFrame(() => requestAnimationFrame(markReady));
      if (stage !== 'playing' || cursor === 0) return;
      // Chrome coarsens performance.now() to 0.1 ms without cross-origin isolation.
      updates.push(Math.round((performance.now() - requested) * 10) / 10);
      if (cursor === source.length) completed = performance.now();
    }, [stage, cursor]);
    useEffect(() => {
      if (stage !== 'playing') return;
      if (cursor < source.length) {
        const timer = setTimeout(() => {
          requested = performance.now();
          setCursor(Math.min(source.length, cursor + chunk));
        }, interval);
        return () => clearTimeout(timer);
      }
      // Settle async highlighting and fades before reading the final DOM.
      const timer = setInterval(() => {
        if (pending() !== 0 || performance.now() - completed < 330) return;
        clearInterval(timer);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const preview = document.getElementById('preview')!;
            const paragraphs = [...preview.querySelectorAll('p')];
            const fences = [...preview.querySelectorAll('pre code')];
            const text = [...paragraphs, ...fences]
              .map((node) => node.textContent)
              .join('')
              .replace(/\s+/g, '');
            let hash = 2166136261;
            for (let i = 0; i < text.length; i++)
              hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
            done({
              updates,
              frames,
              paragraphs: paragraphs.length,
              fences: fences.length,
              // Words writes token colors; Streamdown writes `--sdm-c: inherit` until Shiki colors arrive.
              highlightedFences: fences.filter(
                (node) =>
                  node.querySelector(
                    '[style*="color:"], [style*="--sdm-c: #"]'
                  ) != null
              ).length,
              textHash: hash.toString(16),
              elements: preview.getElementsByTagName('*').length,
              errors,
            });
          })
        );
      }, 30);
      return () => clearInterval(timer);
    }, [stage, cursor]);
    return createElement(
      'main',
      { id: 'preview' },
      createElement(Renderer, {
        key: stage === 'warmup' ? 0 : 1,
        value: stage === 'warmup' ? warmupSource : source.slice(0, cursor),
        active: stage === 'playing' && cursor < source.length,
        highlight,
        animated,
      })
    );
  }
  createRoot(document.getElementById('app')!).render(createElement(App));
}
