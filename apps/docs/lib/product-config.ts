export type ProductId = 'diffs' | 'trees';

export interface ProductConfig {
  id: ProductId;
  name: string;
  tagline: string;
  description: string;
  llmsDescription: string;
  basePath: string;
  docsPath: string;
  themePath?: string;
  packageName: string;
  installCommand: string;
  githubUrl: string;
}

const siteProduct = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = siteProduct === 'trees';

export const PRODUCTS: Record<ProductId, ProductConfig> = {
  diffs: {
    id: 'diffs',
    name: 'Diffs',
    tagline: 'A diff rendering library',
    description:
      "@pierre/diffs is an open source diff and code rendering library. It's built on Shiki for syntax highlighting and theming, is super customizable, and comes packed with features.",
    llmsDescription:
      'An open source diff and code rendering library for the web. Built on Shiki for syntax highlighting, with React and vanilla JS APIs, virtualization, SSR support, and extensive theming.',
    basePath: '',
    docsPath: '/docs',
    themePath: '/theme',
    packageName: '@pierre/diffs',
    installCommand: 'bun i @pierre/diffs',
    githubUrl: 'https://github.com/pierrecomputer/pierre',
  },
  trees: {
    id: 'trees',
    name: 'Trees',
    tagline: 'A file tree rendering library',
    description:
      "@pierre/trees is an open source file tree rendering library. It's built for performance and flexibility, is super customizable, and comes packed with features.",
    llmsDescription:
      'An open source file tree rendering library for the web. Built for extreme performance on large trees, with React and vanilla JS APIs, SSR support, and customizable styling.',
    basePath: isTrees ? '' : '/trees',
    docsPath: isTrees ? '/docs' : '/trees/docs',
    packageName: '@pierre/trees',
    installCommand: 'bun i @pierre/trees',
    githubUrl: 'https://github.com/pierrecomputer/pierre',
  },
};

/** External base URL for the other product's site. */
const EXTERNAL_URLS: Record<ProductId, string> = {
  diffs: 'https://diffs.com',
  trees: 'https://trees.software',
};

/**
 * Theme lives only on the diffs site, so this path is the single source of
 * truth whether we link to it cross-site (trees) or in-site (diffs).
 */
export const DIFFS_THEME_PATH = PRODUCTS.diffs.themePath ?? '/theme';

/**
 * Return the external base URL for the given product.
 * Useful for cross-site links when two products live on separate domains.
 */
export function getExternalUrl(productId: ProductId): string {
  return EXTERNAL_URLS[productId];
}

export function getProductConfig(productId: ProductId): ProductConfig {
  return PRODUCTS[productId];
}

/**
 * Determine which product we're in based on pathname.
 * On the trees site (NEXT_PUBLIC_SITE=trees) every page is a trees page.
 */
export function getProductFromPathname(pathname: string): ProductConfig {
  if (isTrees) {
    return PRODUCTS.trees;
  }
  if (pathname.startsWith('/trees')) {
    return PRODUCTS.trees;
  }
  return PRODUCTS.diffs;
}
