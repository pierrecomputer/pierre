// Static identity for the standalone diffshub site, used for the document
// title/description and the PWA manifest. diffshub ships no package or docs, so
// this is just the display name and tagline rather than a multi-product config.
export const SITE_DESCRIPTION =
  'View code changes from any public GitHub diff or patch URL with a super-freaking-fast, beautiful, and virtualized interface.';
export const SITE_NAME = 'DiffsHub';

export const PROD_ORIGIN = 'https://diffshub.com';

const isDev = process.env.NODE_ENV !== 'production';
const DEV_PORT = process.env.PORT ?? '3692';

/**
 * Origin that absolute metadata URLs resolve against: `metadataBase`,
 * canonicals, `og:url`, and the sitemap/robots entries. In dev this points at
 * localhost so OG previewers fetch in-progress assets instead of production.
 */
export const SITE_ORIGIN = isDev ? `http://localhost:${DEV_PORT}` : PROD_ORIGIN;
