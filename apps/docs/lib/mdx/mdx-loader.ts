import { readFile } from 'fs/promises';
import { h } from 'hastscript';
import { compileMDX } from 'next-mdx-remote/rsc';
import { join } from 'path';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSlug from 'rehype-slug';
import remarkGfm from 'remark-gfm';

import { getMDXComponents } from './mdx-components';

const CONTENT_DIR = join(process.cwd(), 'app', 'docs', '_content');

export interface MDXContentResult<TFrontmatter = Record<string, unknown>> {
  content: React.ReactElement;
  frontmatter: TFrontmatter;
}

/**
 * Load and compile an MDX file from the _content directory
 */
export async function loadMDXContent<
  TFrontmatter = Record<string, unknown>,
  TScope extends Record<string, unknown> = Record<string, unknown>,
>(filename: string, scope?: TScope): Promise<MDXContentResult<TFrontmatter>> {
  const filePath = join(CONTENT_DIR, filename);
  const source = await readFile(filePath, 'utf-8');

  const { content, frontmatter } = await compileMDX<TFrontmatter>({
    source,
    options: {
      parseFrontmatter: true,
      scope,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: 'append',
              properties: {
                className: ['heading-anchor'],
                ariaLabel: 'Link to this section',
              },
              content: () => {
                return [
                  h(
                    'svg',
                    {
                      xmlns: 'http://www.w3.org/2000/svg',
                      fill: 'currentcolor',
                      viewBox: '0 0 16 16',
                      width: '1em',
                      height: '1em',
                      className: 'pi',
                    },
                    [
                      h('path', {
                        d: 'M11.78 2.544a.75.75 0 1 1 1.44.412L12.78 4.5h.97a.75.75 0 0 1 0 1.5h-1.4l-1 3.5h1.4a.75.75 0 0 1 0 1.5h-1.827l-.702 2.456a.75.75 0 1 1-1.442-.412L9.363 11h-4.44l-.702 2.456a.75.75 0 1 1-1.442-.412L3.363 11H2.5a.75.75 0 0 1 0-1.5h1.292l1-3.5H3.75a.75.75 0 0 1 0-1.5h1.47l.56-1.956a.75.75 0 1 1 1.44.412L6.78 4.5h4.44zM5.35 9.5h4.442l1-3.5H6.351z',
                      }),
                    ]
                  ),
                ];
              },
            },
          ],
        ],
      },
    },
    components: getMDXComponents(),
  });

  return {
    content,
    frontmatter,
  };
}
