import type { Metadata, Viewport } from 'next';

import './globals.css';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: false,
  maximumScale: 1,
  viewportFit: 'cover',
  // diffshub body uses --diffshub-sidebar-bg (#f7f7f7 / #101010) rather than
  // the plain neutral background, so it gets its own theme-color pair for the
  // browser chrome address bar.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f7' },
    { media: '(prefers-color-scheme: dark)', color: '#101010' },
  ],
};

// When running in a worktree, prefix the title with a stable emoji + slug so
// browser tabs for different worktrees are distinguishable at a glance. The
// slug reaches this file via `next.config.mjs`, which loads `.env.worktree`
// and bridges `PIERRE_WORKTREE_SLUG` into `NEXT_PUBLIC_WORKTREE_SLUG`. No-op
// in the main clone.
const WORKTREE_EMOJI_PALETTE = [
  '🟢',
  '🔵',
  '🟡',
  '🟠',
  '🟣',
  '🔴',
  '🟤',
  '⚪',
] as const;

function worktreeTitlePrefix(): string {
  const slug = process.env.NEXT_PUBLIC_WORKTREE_SLUG;
  if (!slug) return '';
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  const emoji = WORKTREE_EMOJI_PALETTE[hash % WORKTREE_EMOJI_PALETTE.length];
  return `${emoji} [${slug}] `;
}

const WORKTREE_PREFIX = worktreeTitlePrefix();

const PROD_ORIGIN = 'https://diffshub.com';
// In dev, point `metadataBase` at localhost so OG previewers fetch
// in-progress assets instead of whatever's deployed.
const isDev = process.env.NODE_ENV !== 'production';
const DEV_PORT = process.env.PORT ?? '3692';
const SITE_ORIGIN = isDev ? `http://localhost:${DEV_PORT}` : PROD_ORIGIN;
const baseTitle = `${SITE_NAME}, from Pierre`;
const taggedTitle = `${WORKTREE_PREFIX}${baseTitle}`;
const description = SITE_DESCRIPTION;
const SITE_ICONS: Metadata['icons'] = {
  icon: [
    { url: '/diffshub-brand/icon.svg', type: 'image/svg+xml' },
    { url: '/diffshub-brand/icon.ico', sizes: '32x32' },
  ],
  apple: '/diffshub-brand/apple-icon.png',
};
const SITE_OG_IMAGE = '/diffshub-brand/opengraph-image.png';
const SITE_TWITTER_IMAGE = '/diffshub-brand/twitter-image.png';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: taggedTitle,
    template: `${WORKTREE_PREFIX}%s`,
  },
  description,
  icons: SITE_ICONS,
  openGraph: {
    title: {
      default: taggedTitle,
      template: `${WORKTREE_PREFIX}%s`,
    },
    description,
    images: [SITE_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: {
      default: taggedTitle,
      template: `${WORKTREE_PREFIX}%s`,
    },
    description,
    images: [SITE_TWITTER_IMAGE],
  },
};

export { RootLayout as default } from '@/components/RootLayout';
