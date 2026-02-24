export type ProductId = 'diffs' | 'trees';

export interface ProductConfig {
  id: ProductId;
  name: string;
  tagline: string;
  description: string;
  basePath: string;
  docsPath: string;
  themePath?: string;
  packageName: string;
  installCommand: string;
  githubUrl: string;
}

export const PRODUCTS: Record<ProductId, ProductConfig> = {
  diffs: {
    id: 'diffs',
    name: 'Diffs',
    tagline: 'A diff rendering library',
    description:
      "@pierre/diffs is an open source diff and code rendering library. It's built on Shiki for syntax highlighting and theming, is super customizable, and comes packed with features.",
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
    basePath: '/trees',
    docsPath: '/trees/docs',
    packageName: '@pierre/trees',
    installCommand: 'bun i @pierre/trees',
    githubUrl: 'https://github.com/pierrecomputer/pierre',
  },
};

export function getProductConfig(productId: ProductId): ProductConfig {
  return PRODUCTS[productId];
}

/**
 * Determine which product we're in based on pathname
 */
export function getProductFromPathname(pathname: string): ProductConfig {
  if (pathname.startsWith('/trees')) {
    return PRODUCTS.trees;
  }
  return PRODUCTS.diffs;
}
