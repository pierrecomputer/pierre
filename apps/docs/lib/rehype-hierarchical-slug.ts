import type { Element, Root } from 'hast';
import { headingRank } from 'hast-util-heading-rank';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';

interface Options {
  /**
   * Heading levels to process (e.g., [2, 3] for h2 and h3 only).
   * Defaults to [2, 3, 4, 5, 6] (all headings except h1).
   */
  levels?: number[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/[^\w-]/g, '') // Remove non-word chars (except hyphens)
    .replace(/--+/g, '-') // Replace multiple hyphens with single
    .replace(/^-+|-+$/g, ''); // Trim hyphens from start/end
}

/**
 * Rehype plugin that generates hierarchical heading IDs.
 * Child headings are prefixed with their parent heading's slug.
 *
 * Example:
 *   ## Utilities        -> id="utilities"
 *   ### parsePatchFiles -> id="utilities-parsepatchfiles"
 */
export default function rehypeHierarchicalSlug(options: Options = {}) {
  const { levels = [2, 3, 4, 5, 6] } = options;
  const levelSet = new Set(levels);

  return (tree: Root) => {
    // Track full hierarchical slugs we've used to handle duplicates
    const usedSlugs = new Map<string, number>();
    // Track parent slugs by heading level
    const parentSlugs: Record<number, string> = {};

    visit(tree, 'element', (node: Element) => {
      const rank = headingRank(node);
      if (rank == null) return;

      // Skip if this heading level isn't in our list
      if (!levelSet.has(rank)) return;

      // Skip if already has an ID
      if (node.properties?.id != null) return;

      const text = toString(node);
      const baseSlug = slugify(text);

      // Build hierarchical slug from parent headings
      let slug = baseSlug;

      // Find the nearest parent level that exists
      for (
        let parentLevel = rank - 1;
        parentLevel >= Math.min(...levels);
        parentLevel--
      ) {
        const parentSlug = parentSlugs[parentLevel];
        if (parentSlug != null && parentSlug !== '') {
          slug = `${parentSlug}-${baseSlug}`;
          break;
        }
      }

      // Handle duplicates by tracking used slugs ourselves
      const baseHierarchicalSlug = slug;
      const count = usedSlugs.get(baseHierarchicalSlug) ?? 0;
      if (count > 0) {
        slug = `${baseHierarchicalSlug}-${count}`;
      }
      usedSlugs.set(baseHierarchicalSlug, count + 1);

      // Store this heading's slug for child headings
      parentSlugs[rank] = slug;

      // Clear child levels when we encounter a new parent
      for (let i = rank + 1; i <= 6; i++) {
        delete parentSlugs[i];
      }

      node.properties ??= {};
      node.properties.id = slug;
    });
  };
}
