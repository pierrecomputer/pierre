export const WORDS_EXAMPLE_KINDS = [
  'streaming',
  'fades',
  'code',
  'hooks',
  'playground',
] as const;

export type WordsExampleKind = (typeof WORDS_EXAMPLE_KINDS)[number];

interface WordsUsageOptions {
  custom: boolean;
  fadeDuration: number;
  highlight: boolean;
  lineNumbers: boolean;
  repair: boolean;
}

// Keep the displayed example in sync with the controls that change its output.
export function getWordsUsage({
  custom,
  fadeDuration,
  highlight,
  lineNumbers,
  repair,
}: WordsUsageOptions): string {
  return [
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
    lineNumbers ? '' : '  lineNumbers={false}',
    custom
      ? "  components={{\n    a: (html) => html.replace('<a ', '<a class=\"your-link\" '),\n  }}"
      : '',
    '>',
    '  {text}',
    '</Markdown>',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function getInitialWordsUsage(kind: WordsExampleKind): string {
  return getWordsUsage({
    custom: kind === 'hooks',
    fadeDuration: 180,
    highlight: kind === 'code' || kind === 'playground',
    lineNumbers: kind === 'code' || kind === 'playground',
    repair: true,
  });
}
