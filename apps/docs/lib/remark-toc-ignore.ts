import type { Heading, Root } from 'mdast';
import { visit } from 'unist-util-visit';

const TOC_IGNORE_PATTERN = /\s*\[toc-ignore\]\s*$/;

/**
 * Remark plugin that parses [toc-ignore] from heading text
 * and adds data-toc-ignore as hProperties for rehype to pick up.
 *
 * Usage in MDX:
 *   ### My Heading [toc-ignore]
 *
 * Output:
 *   <h3 data-toc-ignore>My Heading</h3>
 */
export default function remarkTocIgnore() {
  return (tree: Root) => {
    visit(tree, 'heading', (node: Heading) => {
      const lastChild = node.children[node.children.length - 1];

      if (lastChild?.type !== 'text') return;

      const match = lastChild.value.match(TOC_IGNORE_PATTERN);

      if (match == null) return;

      // Remove the {data-toc-ignore} from the text
      lastChild.value = lastChild.value.replace(TOC_IGNORE_PATTERN, '');

      // Add hProperties so rehype will add the data attribute
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = node.data ?? (node.data = {});
      const hProperties = (data.hProperties ??
        (data.hProperties = {})) as Record<string, unknown>;
      hProperties['data-toc-ignore'] = true;
    });
  };
}
