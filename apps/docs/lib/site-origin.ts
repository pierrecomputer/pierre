import type { ProductId } from './product-config';

const PROD_ORIGIN_BY_SITE: Record<ProductId, string> = {
  diffs: 'https://diffs.com',
  trees: 'https://trees.software',
};

const DEV_PORT_BY_SITE: Record<ProductId, string> = {
  diffs: '3690',
  trees: '3691',
};

/**
 * Which product this build serves. One codebase ships two sites, selected at
 * build time, so anything that needs the active product (layout branding,
 * robots.txt, sitemap.xml, canonical URLs) reads this rather than re-deriving
 * it from the env var.
 */
export const SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') as ProductId;

/** The public origin this site is deployed to. */
export const PROD_ORIGIN = PROD_ORIGIN_BY_SITE[SITE];

const isDev = process.env.NODE_ENV !== 'production';
const DEV_PORT = process.env.PORT ?? DEV_PORT_BY_SITE[SITE];

/**
 * Origin that every absolute metadata URL resolves against: `metadataBase`,
 * canonicals, `og:url`, and the sitemap/robots entries. In dev this points at
 * localhost so OG previewers fetch in-progress assets and so a locally
 * generated sitemap lists URLs you can actually click.
 */
export const SITE_ORIGIN = isDev ? `http://localhost:${DEV_PORT}` : PROD_ORIGIN;
