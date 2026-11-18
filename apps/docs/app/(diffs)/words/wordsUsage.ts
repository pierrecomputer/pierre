export const WORDS_EXAMPLE_KINDS = [
  'streaming',
  'fades',
  'code',
  'hooks',
  'diagrams',
  'reactive-islands',
  'playground',
] as const;

export type WordsExampleKind = (typeof WORDS_EXAMPLE_KINDS)[number];

interface WordsUsageOptions {
  custom: boolean;
  fadeDuration: number;
  highlight: boolean;
  lineNumbers: boolean;
  diagrams?: boolean;
  islands?: boolean;
  repair: boolean;
}

// Keep the displayed example in sync with the controls that change its output.
export function getWordsUsage({
  custom,
  fadeDuration,
  highlight,
  lineNumbers,
  diagrams = false,
  islands = false,
  repair,
}: WordsUsageOptions): string {
  const props = [
    'isAnimating={isStreaming}',
    repair ? '' : 'parseIncompleteMarkdown={false}',
    "animated={{ animation: 'fadeIn', duration: " + fadeDuration + ' }}',
    diagrams ? 'math' : '',
    islands ? 'islands={islands}' : '',
    highlight || diagrams ? 'plugins={plugins}' : '',
    lineNumbers ? '' : 'lineNumbers={false}',
    custom
      ? "components={{\n  a: (html) => html.replace('<a ', '<a class=\"your-link\" '),\n}}"
      : '',
  ]
    .filter((prop) => prop !== '')
    .map((prop) => '      ' + prop.replaceAll('\n', '\n      '));
  return [
    "import { Markdown } from '@pierre/words/react';\nimport '@pierre/words/styles.css';" +
      (islands
        ? "\nimport type { ReactiveIslands } from '@pierre/words/react';\nimport { useState } from 'react';"
        : '') +
      (highlight
        ? "\nimport { createHighlightsPlugin } from '@pierre/words/highlights';\nimport light from '@pierre/highlights/themes/pierre-light';\nimport dark from '@pierre/highlights/themes/pierre-dark';"
        : '') +
      (diagrams
        ? "\nimport { createMermaidPlugin } from '@pierre/words/mermaid';\nimport { render } from 'pele';"
        : ''),
    islands ? islandsUsage : '',
    diagrams
      ? 'const plugins = {\n  mermaid: createMermaidPlugin({ render }),\n};'
      : highlight
        ? "const plugins = {\n  code: createHighlightsPlugin({ themes: { light, dark }, defaultColor: 'light-dark()' }),\n};"
        : '',
    [
      'export function Message({ text, isStreaming }) {',
      '  return (',
      '    <Markdown',
      ...props,
      '    >',
      '      {text}',
      '    </Markdown>',
      '  );',
      '}',
    ].join('\n'),
  ]
    .filter((block) => block !== '')
    .join('\n\n');
}

export function getInitialWordsUsage(kind: WordsExampleKind): string {
  return getWordsUsage({
    custom: kind === 'hooks',
    fadeDuration: 180,
    highlight: kind === 'code' || kind === 'playground',
    lineNumbers: kind === 'code' || kind === 'playground',
    diagrams: kind === 'diagrams',
    islands: kind === 'reactive-islands',
    repair: true,
  });
}

export const detailsPending = 'Show details';

const islandsUsage = [
  'function Counter({ label }: { label: string }) {',
  '  const [count, setCount] = useState(0);',
  '  return (',
  '    <button type="button" onClick={() => setCount((value) => value + 1)}>',
  '      {label} ({count})',
  '    </button>',
  '  );',
  '}',
  '',
  'function Details({ text }: { text: string }) {',
  '  const [expanded, setExpanded] = useState(false);',
  '  return (',
  '    <>',
  '      <button type="button" className="h-9 w-40" aria-expanded={expanded}',
  '        onClick={() => setExpanded((value) => !value)}>',
  "        {expanded ? 'Hide details' : 'Show details'}",
  '      </button>',
  '      {expanded && <p>{text}</p>}',
  '    </>',
  '  );',
  '}',
  '',
  'const islands: ReactiveIslands = {',
  '  counter: {',
  "    fallback: '',",
  '    render: ({ label }) =>',
  "      typeof label === 'string' ? <Counter label={label} /> : null,",
  '  },',
  '  details: {',
  "    pending: '" + detailsPending + "',",
  "    fallback: 'Details are available when the page is interactive.',",
  '    render: ({ text }) =>',
  "      typeof text === 'string' ? <Details text={text} /> : null,",
  '  },',
  '};',
].join('\n');
