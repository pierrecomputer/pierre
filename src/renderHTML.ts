import { codeToHtml } from 'shiki';

interface RenderToHTMLProps {
  content: string;
  lang?: 'yaml';
  showLineNumbers?: boolean;
  startingLine?: number;
}

export async function renderToHTML({
  content,
  lang = 'yaml',
  showLineNumbers = false,
}: RenderToHTMLProps) {
  return codeToHtml(content, {
    lang,
    themes: { light: 'min-light', dark: 'min-dark' },
    defaultColor: false,
    transformers: [
      {
        code(code) {
          code.properties['data-code'] = '';
        },
        line(node, line) {
          node.tagName = 'div';
          node.properties['data-column-content'] = '';
          delete node.properties.class;
          const children = [node];
          if (showLineNumbers) {
            children.unshift({
              tagName: 'div',
              type: 'element',
              properties: {
                'data-column-number': '',
              },
              children: [{ type: 'text', value: `${line}` }],
            });
          }
          return {
            tagName: 'div',
            type: 'element',
            properties: {
              'data-line': `${line}`,
            },
            children,
          };
        },
        pre(pre) {
          pre.properties['data-theme'] = 'dark';
          delete pre.properties.class;
        },
      },
    ],
  });
}
