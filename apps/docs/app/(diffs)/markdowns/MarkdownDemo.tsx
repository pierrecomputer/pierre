'use client';

import pierreDark from '@pierre/highlights/themes/pierre-dark';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import { createHighlightsPlugin } from '@pierre/markdowns/highlights';
import { Markdown } from '@pierre/markdowns/react';
import type { Components } from '@pierre/markdowns/react';
import '@pierre/markdowns/styles.css';
import { useEffect, useState } from 'react';

import {
  createStressFixture,
  STRESS_BASE_CHARACTERS,
  STRESS_SCALES,
} from '../../../../../packages/markdowns/benchmark/fixtures.mjs';
import styles from './MarkdownDemo.module.css';
import { Button } from '@/components/ui/button';

const samples = {
  conversation: `## A little room for better ideas\n\nGood tools get out of your way. **Great tools make you want to keep going.**\n\nThis response arrives a few characters at a time. Watch *emphasis*, [links](https://diffs.com), and code find their shape.\n\n### Built for the conversation\n\n- [x] Write naturally, with **GitHub Flavored Markdown**\n- [x] Bring your own React components\n- [ ] Make something worth sharing\n\n\`\`\`tsx\nimport { Markdown } from '@pierre/markdowns/react';
\n\nexport function Message({ text, streaming }) {\n  return (\n    <Markdown isAnimating={streaming} caret="block">\n      {text}\n    </Markdown>\n  );\n}\n\`\`\`\n\n| A familiar idea | A thoughtful detail |\n| :--- | :--- |\n| Markdown | Tables, tasks, and footnotes |\n| Streaming | Formatting before the final token |\n| Code | Highlighted by Pierre Highlights |\n\n> The best part of a good tool is what you make with it.\n\nKeep exploring [Pierre][pierre]. Every detail counts.[^1]\n\n[pierre]: https://diffs.com\n[^1]: Even the little ones at the bottom of the page.`,
  code: `## From a thought to a function\n\nA tiny generator, with a little **room to breathe**.\n\n\`\`\`typescript\nasync function* words(message: string) {\n  for (const word of message.split(' ')) {\n    yield word + ' ';\n    await new Promise((resolve) => setTimeout(resolve, 60));\n  }\n}\n\nfor await (const word of words('Hello, world.')) {\n  process.stdout.write(word);\n}\n\`\`\`\n\nInline code, like \`yield word\`, gets its own treatment. Unknown languages fall back to plain text.`,
  references: `## The details come together\n\nThis [reference link][guide] resolves when its definition arrives below. A footnote can arrive later, too.[^note]\n\n- First, an idea\n- Then, a **little more detail**\n- Finally, the pieces fit together\n\n[guide]: https://diffs.com/docs\n[^note]: Earlier content updates when later definitions give it new meaning.`,
} as const;
const plugins = {
  code: createHighlightsPlugin({
    themes: { light: pierreLight, dark: pierreDark },
    defaultColor: 'light-dark()',
  }),
};
const overrides: Components = {
  h2: ({ children }) => (
    <h2 className={styles.customHeading}>
      <span aria-hidden="true">✳</span>
      {children}
    </h2>
  ),
  a: ({ children, href, title }) => (
    <a className={styles.customLink} href={href} title={title}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  ),
  inlineCode: ({ children }) => (
    <code className={styles.customInline}>{children}</code>
  ),
};

/** Playback uses the accumulated string, exactly like an AI SDK text message. */
export function MarkdownDemo() {
  const [sample, setSample] = useState('conversation');
  const [stressScale, setStressScale] = useState<1 | 100 | 1000 | undefined>();
  const [source, setSource] = useState<string>(samples.conversation);
  const [cursor, setCursor] = useState(source.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [repair, setRepair] = useState(true);
  const [custom, setCustom] = useState(false);
  const [highlight, setHighlight] = useState(true);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [animated, setAnimated] = useState(true);
  const [fadeDuration, setFadeDuration] = useState(180);
  const charactersPerStep = speed * (stressScale ?? 1);
  const isStreaming = playing && cursor < source.length;
  useEffect(() => {
    if (!isStreaming) return;
    const timer = setTimeout(
      () =>
        setCursor((value) =>
          Math.min(source.length, value + charactersPerStep)
        ),
      40
    );
    return () => clearTimeout(timer);
  }, [isStreaming, cursor, source.length, charactersPerStep]);
  const changeSource = (value: string): void => {
    setPlaying(false);
    setSample('custom');
    setSource(value);
    setCursor(stressScale === undefined ? value.length : 0);
  };
  const selectSample = (value: string): void => {
    const scale = STRESS_SCALES.find((scale) => value === `stress-${scale}`);
    const nextSource =
      scale === undefined
        ? samples[value as keyof typeof samples]
        : createStressFixture(scale);
    setSample(value);
    setStressScale(scale);
    setSpeed(scale === undefined ? 8 : 32);
    setPlaying(false);
    setSource(nextSource);
    // Large examples wait for playback or Show all before building their preview.
    setCursor(scale === undefined ? nextSource.length : 0);
  };
  const start = (): void => {
    if (cursor >= source.length) setCursor(0);
    setPlaying(true);
  };
  const progress =
    source.length === 0 ? 100 : Math.round((cursor / source.length) * 100);
  return (
    <section
      aria-label="Markdown playground"
      className={styles.demo}
      data-stream-cursor={cursor}
      data-stream-length={source.length}
    >
      <div className={styles.toolbar}>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setCursor(0);
              setPlaying(true);
            }}
            disabled={source.length === 0}
          >
            ↻ Replay stream
          </Button>
          {isStreaming ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPlaying(false)}
            >
              Pause
            </Button>
          ) : (
            cursor < source.length && (
              <Button variant="outline" size="sm" onClick={start}>
                Resume
              </Button>
            )
          )}
          {cursor < source.length && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPlaying(false);
                setCursor(source.length);
              }}
            >
              Show all
            </Button>
          )}
        </div>
        <label className={styles.sampleLabel}>
          Example{' '}
          <select
            aria-label="Markdown example"
            value={sample}
            onChange={(event) => selectSample(event.target.value)}
          >
            <option value="conversation">A conversation</option>
            <option value="code">A little code</option>
            <option value="references">Late-arriving references</option>
            {STRESS_SCALES.map((scale) => (
              <option key={scale} value={`stress-${scale}`}>
                {scale === 1 ? 'Long response' : 'Large sample'} · {scale}× (
                {scale === 1000
                  ? `${((STRESS_BASE_CHARACTERS * scale + 2 * (scale - 1)) / 1_000_000).toFixed(1)} MB`
                  : `${((STRESS_BASE_CHARACTERS * scale + 2 * (scale - 1)) / 1000).toFixed(1)} KB`}
                )
              </option>
            ))}
            {sample === 'custom' && <option value="custom">Your text</option>}
          </select>
        </label>
      </div>
      <div className={styles.options}>
        <label>
          <input
            type="checkbox"
            checked={repair}
            onChange={(e) => setRepair(e.target.checked)}
          />{' '}
          Complete formatting
        </label>
        <label>
          <input
            type="checkbox"
            checked={custom}
            onChange={(e) => setCustom(e.target.checked)}
          />{' '}
          Custom components
        </label>
        <label>
          <input
            type="checkbox"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
          />{' '}
          Highlight code
        </label>
        <label>
          <input
            type="checkbox"
            checked={lineNumbers}
            onChange={(e) => setLineNumbers(e.target.checked)}
          />{' '}
          Line numbers
        </label>
        <label>
          <input
            type="checkbox"
            checked={animated}
            onChange={(e) => setAnimated(e.target.checked)}
          />{' '}
          Fade in tokens
        </label>
        {animated && (
          <label>
            Fade duration{' '}
            <input
              aria-label="Fade duration"
              type="range"
              min="0"
              max="800"
              step="20"
              value={fadeDuration}
              onChange={(e) => setFadeDuration(Number(e.target.value))}
            />
            <span>{fadeDuration} ms</span>
          </label>
        )}
        <label className={styles.speed}>
          Speed{' '}
          <input
            aria-label="Streaming speed"
            type="range"
            min="1"
            max="32"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
      </div>
      <div className={styles.panes}>
        <div className={styles.editorPane}>
          <div className={styles.paneTitle}>
            <label htmlFor="markdown-source">Source</label>
            <span>Markdown</span>
          </div>
          <textarea
            id="markdown-source"
            aria-label="Markdown source"
            value={source}
            spellCheck={false}
            onChange={(event) => changeSource(event.target.value)}
          />
        </div>
        <div className={styles.previewPane}>
          <div className={styles.paneTitle}>
            <span>Preview</span>
            <span role="status">
              {isStreaming
                ? 'Streaming…'
                : cursor < source.length
                  ? 'Paused'
                  : 'Ready'}
            </span>
          </div>
          <div className={styles.preview} aria-busy={isStreaming}>
            <Markdown
              isAnimating={isStreaming}
              animated={
                animated
                  ? { animation: 'fadeIn', duration: fadeDuration }
                  : false
              }
              parseIncompleteMarkdown={repair}
              components={custom ? overrides : undefined}
              plugins={highlight ? plugins : undefined}
              lineNumbers={lineNumbers}
              caret="block"
            >
              {source.slice(0, cursor)}
            </Markdown>
          </div>
        </div>
      </div>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Stream progress"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className={styles.status}>
        <span>
          {cursor.toLocaleString()} / {source.length.toLocaleString()}{' '}
          characters
        </span>
        <span>
          {stressScale === undefined
            ? 'Make an edit. See it take shape.'
            : `${stressScale}× sample · ${charactersPerStep.toLocaleString()} characters per step${cursor === 0 && !isStreaming ? ' · Resume to begin' : ''}`}
        </span>
      </div>
      <details className={styles.usage}>
        <summary>Use it in your app</summary>
        <pre>{`import { Markdown } from '@pierre/markdowns/react';
\nimport '@pierre/markdowns/styles.css';\n\n<Markdown\n  isAnimating={status === 'streaming'}\n  parseIncompleteMarkdown={${repair}}\n  animated={${animated ? `{ animation: 'fadeIn', duration: ${fadeDuration} }` : 'false'}}\n  lineNumbers={${lineNumbers}}\n  caret="block"\n>\n  {message.text}\n</Markdown>`}</pre>
      </details>
    </section>
  );
}
