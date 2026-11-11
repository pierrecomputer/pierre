import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const WORDS_INSTALL = docsCodeSnippet(
  'install.sh',
  'pnpm add @pierre/words'
);

export const WORDS_SKILL = docsCodeSnippet(
  'skill.sh',
  'npx skills add pierrecomputer/pierre --skill words'
);

export const WORDS_REACT = docsCodeSnippet(
  'message.tsx',
  `import { Markdown } from '@pierre/words/react';
import '@pierre/words/styles.css';

export function Message({ text, active }: { text: string; active: boolean }) {
  return (
    <Markdown isAnimating={active} animated caret="block">
      {text}
    </Markdown>
  );
}`
);

export const WORDS_HIGHLIGHTS = docsCodeSnippet(
  'highlighted-message.tsx',
  `import { createHighlightsPlugin } from '@pierre/words/highlights';
import { Markdown } from '@pierre/words/react';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import '@pierre/words/styles.css';

const plugins = { code: createHighlightsPlugin({ theme: pierreLight }) };

export function Message({ text, active }: { text: string; active: boolean }) {
  return (
    <Markdown plugins={plugins} isAnimating={active}>
      {text}
    </Markdown>
  );
}`
);

export const WORDS_HTML = docsCodeSnippet(
  'html.ts',
  `import { createHtmlRenderer } from '@pierre/words/html';

const renderer = createHtmlRenderer({ controls: false, idPrefix: 'article-' });
try {
  const { html } = renderer.render('# Hello, **world**!', false);
  console.log(html);
} finally {
  renderer.dispose();
}`
);

export const WORDS_DOM = docsCodeSnippet(
  'dom.ts',
  `import { createDomRenderer } from '@pierre/words/html';
import '@pierre/words/styles.css';

const root = document.createElement('div');
document.body.append(root);
const renderer = createDomRenderer(root, { idPrefix: 'message-' });
renderer.connect();
renderer.update('Hello, **world', true, true, true, 'block');
renderer.update('Hello, **world**!', false, false);`
);

export const WORDS_HOOKS = docsCodeSnippet(
  'hooks.ts',
  `import { createHtmlRenderer } from '@pierre/words/html';

const renderer = createHtmlRenderer({
  components: {
    a: (html) => html.replace('<a ', '<a class="message-link" '),
    inlineCode: (html) => html.replace('<code ', '<code class="inline-code" '),
  },
  urlTransform: (url, key) => key === 'src' ? null : url,
});

try {
  const { html } = renderer.render('[Guide](/guide)', false);
  console.log(html);
} finally {
  renderer.dispose();
}`
);

export const WORDS_CORE = docsCodeSnippet(
  'core.ts',
  `import { renderToAnsi, renderToHtml } from '@pierre/words';

const source = '# Hello, **world**!';
const html = new TextDecoder().decode(renderToHtml(source));
const ansi = renderToAnsi(source, { width: 80 }).slice();

console.log(html);
process.stdout.write(ansi);`
);

export const WORDS_FRONTMATTER = docsCodeSnippet(
  'frontmatter.ts',
  `import { renderToHtml } from '@pierre/words';

const [meta, bytes] = renderToHtml('---\\ntitle: Hello\\n---\\n# Welcome', {
  frontmatter: true,
});
const html = new TextDecoder().decode(bytes);
console.log(meta, html);`
);

export const WORDS_SESSION = docsCodeSnippet(
  'session.ts',
  `import { createHtmlSession } from '@pierre/words';

const session = createHtmlSession();
const first = session.render('First paragraph.\\n\\nSecond', {
  incomplete: true,
});
console.log(first.stable, first.pending);

const final = session.render('First paragraph.\\n\\nSecond paragraph.');
console.log(final.html);`
);

export const WORDS_DOC_FILES = {
  wordsInstall: WORDS_INSTALL,
  wordsSkill: WORDS_SKILL,
  wordsReact: WORDS_REACT,
  wordsHighlights: WORDS_HIGHLIGHTS,
  wordsHtml: WORDS_HTML,
  wordsDom: WORDS_DOM,
  wordsHooks: WORDS_HOOKS,
  wordsCore: WORDS_CORE,
  wordsFrontmatter: WORDS_FRONTMATTER,
  wordsSession: WORDS_SESSION,
};
