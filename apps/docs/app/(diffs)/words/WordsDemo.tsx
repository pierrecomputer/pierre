'use client';

import pierreDark from '@pierre/highlights/themes/pierre-dark';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import {
  IconCheck,
  IconChevronSm,
  IconCodeBlock,
  IconListOrdered,
  IconRefresh,
} from '@pierre/icons';
import { createHighlightsPlugin } from '@pierre/words/highlights';
import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';
import type { Components } from '@pierre/words/react';
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  createStressFixture,
  STRESS_BASE_CHARACTERS,
  STRESS_SCALES,
} from '../../../../../packages/words/benchmark/fixtures';
import { getBenchmarkGradientStyle } from '../highlights/BenchmarkBar';
import rainbowStyles from '../highlights/HighlightsRainbow.module.css';
import styles from './WordsDemo.module.css';
import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const samples = {
  conversation: `## A little room for better ideas\n\nGood tools get out of your way. **Great tools make you want to keep going.**\n\nThis response arrives a few characters at a time. Watch *emphasis*, [links](https://diffs.com), and code find their shape.\n\n### Built for the conversation\n\n- [x] Write naturally, with **GitHub Flavored Markdown**\n- [x] Customize the generated HTML\n- [ ] Make something worth sharing\n\n\`\`\`tsx\nimport { Markdown } from '@pierre/words/react';
\n\nexport function Message({ text, streaming }) {\n  return (\n    <Markdown isAnimating={streaming}>\n      {text}\n    </Markdown>\n  );\n}\n\`\`\`\n\n| A familiar idea | A thoughtful detail |\n| :--- | :--- |\n| Markdown | Tables, tasks, and footnotes |\n| Streaming | Formatting before the final token |\n| Code | Highlighted by Pierre Highlights |\n\n> The best part of a good tool is what you make with it.\n\nKeep exploring [Pierre][pierre]. Every detail counts.[^1]\n\n[pierre]: https://diffs.com\n[^1]: Even the little ones at the bottom of the page.`,
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
  // Keep streamed title spans inside one flex item beside the icon.
  h2: (html) =>
    html
      .replace('<h2 ', `<h2 class="${styles.customHeading}" `)
      .replace(/^(<h2[^>]*>)/, '$1<span aria-hidden="true">✳</span><span>')
      .replace('</h2>', '</span></h2>'),
  a: (html) =>
    html
      .replace('<a ', `<a class="${styles.customLink}" `)
      .replace('</a>', '<span aria-hidden="true"> ↗</span></a>'),
  inlineCode: (html) =>
    html.replace('<code ', `<code class="${styles.customInline}" `),
};

type ExampleKind = 'streaming' | 'fades' | 'code' | 'hooks' | 'playground';
const hooksSample =
  '## HTML render hooks\n\nMake [links](https://diffs.com) feel at home in your app. Style `inline code`, add an icon to headings, and keep **the same Markdown**.\n\n### Keep your own style\n\n- Return HTML strings from your hooks\n- Let Words handle the streaming updates\n- Use your own classes and design tokens';
const streamingSample =
  samples.conversation.slice(
    0,
    samples.conversation.indexOf('### Built for the conversation')
  ) +
  '- Start with an idea\n- Add a **little more detail**\n- Keep the conversation going\n\n> The best part of a good tool is what you make with it.';
const speeds = [
  { label: 'Slow', value: 1 },
  { label: 'Normal', value: 8 },
  { label: 'Fast', value: 32 },
];
const exampleScales = STRESS_SCALES.filter((scale) => scale !== 1000);
const sampleOptions = [
  { value: 'conversation', label: 'A conversation' },
  { value: 'code', label: 'A little code' },
  { value: 'references', label: 'Late-arriving references' },
  ...exampleScales.map((scale) => ({
    value: 'stress-' + scale,
    label:
      (scale === 1 ? 'Long response' : 'Large sample') +
      ' · ' +
      scale +
      '× (' +
      ((STRESS_BASE_CHARACTERS * scale + 2 * (scale - 1)) / 1000).toFixed(1) +
      ' KB)',
  })),
];

/** Match Edit mode's toggle pill with one accessible button and a visual switch. */
function ExampleSwitch({
  label,
  icon,
  checked,
  onCheckedChange,
  setting,
}: {
  label: string;
  icon: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  setting?: string;
}) {
  return (
    <div className="gridstack">
      <Button
        variant="outline"
        className="justify-between gap-3 pr-11 pl-3"
        role="switch"
        aria-checked={checked}
        data-setting={setting}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
      </Button>
      <Switch
        checked={checked}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none mr-3 place-self-center justify-self-end"
      />
    </div>
  );
}

/** Each feature owns its playback so controls and edits stay local to that example. */
function WordsExample({
  kind,
  title,
  description,
}: {
  kind: ExampleKind;
  title: string;
  description: ReactNode;
}) {
  const playground = kind === 'playground';
  const fixedSpeed =
    kind === 'streaming' || kind === 'code' || kind === 'hooks';
  const initialSource =
    kind === 'code'
      ? samples.code
      : kind === 'hooks'
        ? hooksSample
        : playground
          ? samples.conversation
          : streamingSample;
  const previewRef = useRef<HTMLDivElement>(null);
  const [sample, setSample] = useState(
    kind === 'streaming' ? 'streaming' : 'conversation'
  );
  const [stressScale, setStressScale] = useState<1 | 100 | 1000 | undefined>();
  const [source, setSource] = useState<string>(initialSource);
  const [cursor, setCursor] = useState(initialSource.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [parseIncomplete, setRepair] = useState(true);
  const repair = playground || parseIncomplete;
  const [customHtml, setCustom] = useState(kind === 'hooks');
  const custom = kind === 'hooks' && customHtml;
  const highlight = kind === 'code' || playground;
  const [numbered, setLineNumbers] = useState(kind === 'code');
  const lineNumbers = playground || numbered;
  const [fadeDuration, setFadeDuration] = useState(180);
  const charactersPerStep = (fixedSpeed ? 8 : speed) * (stressScale ?? 1);
  const isStreaming = playing && cursor < source.length;
  const sourceId = playground ? 'markdown-source' : 'words-' + kind + '-source';
  const sourceLabel = playground ? 'Markdown source' : title + ' source';
  const progress =
    source.length === 0 ? 100 : Math.round((cursor / source.length) * 100);
  const progressState =
    cursor >= source.length
      ? 'complete'
      : cursor === 0
        ? 'empty'
        : isStreaming
          ? 'streaming'
          : 'paused';

  // Follow each committed chunk only in the scrollable longer-run preview.
  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (playground && playing && preview !== null)
      preview.scrollTop = preview.scrollHeight;
  }, [cursor, playing, playground]);
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

  const selectSample = (value: string): void => {
    const scale = exampleScales.find((scale) => value === 'stress-' + scale);
    const nextSource =
      scale === undefined
        ? value === 'streaming'
          ? streamingSample
          : samples[value as keyof typeof samples]
        : createStressFixture(scale);
    setSample(value);
    setStressScale(scale);
    setSpeed(scale === undefined ? 8 : 32);
    setPlaying(false);
    setSource(nextSource);
    // Large documents wait for playback instead of building their entire preview on selection.
    setCursor(scale === undefined ? nextSource.length : 0);
  };
  const replay = (): void => {
    setCursor(0);
    setPlaying(true);
  };
  const usage = [
    "import { Markdown } from '@pierre/words/react';",
    "import '@pierre/words/styles.css';",
    highlight
      ? "import { createHighlightsPlugin } from '@pierre/words/highlights';\nimport light from '@pierre/highlights/themes/pierre-light';\nimport dark from '@pierre/highlights/themes/pierre-dark';\n\nconst plugins = {\n  code: createHighlightsPlugin({ themes: { light, dark }, defaultColor: 'light-dark()' }),\n};"
      : '',
    '',
    '<Markdown',
    '  isAnimating={isStreaming}',
    !repair ? '  parseIncompleteMarkdown={false}' : '',
    "  animated={{ animation: 'fadeIn', duration: " + fadeDuration + ' }}',
    highlight ? '  plugins={plugins}' : '',
    lineNumbers ? '  lineNumbers' : '',
    custom
      ? "  components={{\n    a: (html) => html.replace('<a ', '<a class=\"your-link\" '),\n  }}"
      : '',
    '>',
    '  {text}',
    '</Markdown>',
  ]
    .filter((line) => line !== '')
    .join('\n');
  const selectedSample =
    sampleOptions.find(({ value }) => value === sample)?.label ?? 'Your text';

  const replayButton = (
    <Button
      variant="outline"
      onClick={replay}
      disabled={source.length === 0}
      data-action="replay"
    >
      <IconRefresh aria-hidden="true" />
      Replay stream
    </Button>
  );

  const parseIncompleteControl = (
    <ExampleSwitch
      label="Parse incomplete"
      icon={<IconCodeBlock aria-hidden="true" />}
      checked={repair}
      onCheckedChange={setRepair}
      setting="repair"
    />
  );

  const playbackControls = (
    <>
      {kind === 'fades' && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-muted-foreground text-sm">Speed</span>
          <ButtonGroup
            value={String(speed)}
            onValueChange={(value) => setSpeed(Number(value))}
            size="sm"
            aria-label={title + ' speed'}
          >
            {speeds.map(({ label, value }) => (
              <ButtonGroupItem
                key={value}
                value={String(value)}
                aria-pressed={speed === value}
              >
                {label}
              </ButtonGroupItem>
            ))}
          </ButtonGroup>
        </div>
      )}
      {kind === 'streaming' && parseIncompleteControl}
      {kind === 'fades' && (
        <label className={styles.range}>
          Duration
          <input
            aria-label="Token fade duration"
            type="range"
            min="0"
            max="800"
            step="20"
            value={fadeDuration}
            onChange={(event) => setFadeDuration(Number(event.target.value))}
          />
          <span className="tabular-nums">{fadeDuration} ms</span>
        </label>
      )}
    </>
  );

  return (
    <section
      aria-label={playground ? 'Markdown playground' : title}
      aria-labelledby={'words-' + kind}
      className="space-y-5 pb-16 md:pb-24"
      data-words-example={kind}
      data-stream-cursor={cursor}
      data-stream-length={source.length}
      data-stream-step={charactersPerStep}
      data-fade-duration={fadeDuration}
      data-highlight={highlight}
    >
      <FeatureHeader
        id={'words-' + kind}
        title={title}
        description={description}
      />
      <div className="flex flex-wrap items-center gap-3" data-words-toolbar>
        {(fixedSpeed || playground) && replayButton}
        {kind === 'streaming' && (
          <ButtonGroup
            value={sample}
            onValueChange={selectSample}
            aria-label="Streaming example"
          >
            <ButtonGroupItem
              value="streaming"
              aria-pressed={sample === 'streaming'}
            >
              Conversation
            </ButtonGroupItem>
            <ButtonGroupItem
              value="references"
              aria-pressed={sample === 'references'}
            >
              Late references
            </ButtonGroupItem>
          </ButtonGroup>
        )}
        {kind === 'hooks' && (
          <ButtonGroup
            value={custom ? 'custom' : 'default'}
            onValueChange={(value) => setCustom(value === 'custom')}
            aria-label="HTML rendering"
          >
            <ButtonGroupItem value="custom" aria-pressed={custom}>
              Custom HTML
            </ButtonGroupItem>
            <ButtonGroupItem value="default" aria-pressed={!custom}>
              Default HTML
            </ButtonGroupItem>
          </ButtonGroup>
        )}
        {kind === 'code' && (
          <ExampleSwitch
            label="Line numbers"
            icon={<IconListOrdered aria-hidden="true" />}
            checked={lineNumbers}
            onCheckedChange={setLineNumbers}
          />
        )}
        {!fixedSpeed && !playground && replayButton}
        {(kind === 'fades' || kind === 'streaming') && playbackControls}
        {playground && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" aria-label="Markdown example">
                <span className="max-w-[14rem] truncate">{selectedSample}</span>
                <IconChevronSm aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" scrollSelectedIntoView>
              {sampleOptions.map(({ value, label }) => (
                <DropdownMenuItem
                  key={value}
                  selected={sample === value}
                  data-example-value={value}
                  onSelect={() => selectSample(value)}
                >
                  {label}
                  {sample === value && (
                    <IconCheck className="ml-auto" aria-hidden="true" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className={`${styles.demo} dark`} data-scrollable={playground}>
        <div className={styles.panes} data-source-visible={playground}>
          {playground && (
            <div className={styles.editorPane}>
              <div className={styles.paneTitle}>
                <label htmlFor={sourceId}>Markdown source</label>
                <span>Editable</span>
              </div>
              <textarea
                id={sourceId}
                aria-label={sourceLabel}
                value={source}
                spellCheck={false}
                onChange={(event) => {
                  setPlaying(false);
                  setSample('custom');
                  setSource(event.target.value);
                  setCursor(
                    stressScale === undefined ? event.target.value.length : 0
                  );
                }}
              />
            </div>
          )}
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
            <div
              ref={previewRef}
              className={styles.preview}
              aria-busy={isStreaming}
            >
              <Markdown
                isAnimating={isStreaming}
                animated={{ animation: 'fadeIn', duration: fadeDuration }}
                parseIncompleteMarkdown={repair}
                components={custom ? overrides : undefined}
                plugins={highlight ? plugins : undefined}
                lineNumbers={lineNumbers}
              >
                {source.slice(0, cursor)}
              </Markdown>
            </div>
          </div>
        </div>
        <div
          className={styles.progress}
          data-state={progressState}
          role="progressbar"
          aria-label={playground ? 'Stream progress' : title + ' progress'}
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`${styles.progressFill} ${rainbowStyles.benchmarkRainbow}`}
            style={{
              width: progress + '%',
              ...(progress > 0 ? getBenchmarkGradientStyle(progress, 100) : {}),
            }}
          />
        </div>
        <div className={styles.status}>
          <span>
            {cursor.toLocaleString()} / {source.length.toLocaleString()}{' '}
            characters
          </span>
          <span>
            {stressScale === undefined
              ? 'Edit the source or replay the response.'
              : stressScale +
                '× sample · ' +
                charactersPerStep.toLocaleString() +
                ' characters per step'}
          </span>
        </div>
      </div>
      <details className={styles.usage}>
        <summary>Use it in React</summary>
        <pre>
          <code>{usage}</code>
        </pre>
      </details>
    </section>
  );
}

export function WordsDemo() {
  return (
    <div id="examples" className="scroll-mt-20">
      <WordsExample
        kind="fades"
        title="A softer arrival"
        description={
          <>
            Fade in new text with <code>animated</code>. Existing text keeps its
            place, and reduced-motion preferences are respected. Adjust the
            duration and replay to find the right pace.
          </>
        }
      />
      <WordsExample
        kind="streaming"
        title="Built for the conversation"
        description={
          <>
            Stream a response without waiting for the final token. Emphasis,
            links, lists, and late references settle into place as text arrives.
          </>
        }
      />
      <WordsExample
        kind="code"
        title="Code that keeps up"
        description={
          <>
            Add <code>@pierre/highlights</code> to highlight code as it streams.
            Toggle line numbers and replay the example to watch it take shape.
          </>
        }
      />
      <WordsExample
        kind="hooks"
        title="Your HTML, your way"
        description={
          <>
            Customize the generated HTML with string hooks. Switch between the
            default output and styled headings, links, and inline code without
            changing the Markdown.
          </>
        }
      />
      <WordsExample
        kind="playground"
        title="Take it for a longer run"
        description={
          <>
            Try your own Markdown or choose a larger document. Large samples
            wait for you to replay the stream before rendering their preview.
          </>
        }
      />
    </div>
  );
}
