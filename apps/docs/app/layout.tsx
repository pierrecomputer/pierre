// sort-imports-ignore
import type { Metadata, Viewport } from 'next';
import {
  Fira_Code,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  Inter,
  JetBrains_Mono,
} from 'next/font/google';
import localFont from 'next/font/local';

import './globals.css';
import { Fragment } from 'react';

import { WorkerPoolContext } from './(diffs)/_components/WorkerPoolContext';
import { PreloadHighlighter } from '@/components/PreloadHighlighter';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { type ProductId, PRODUCTS } from '@/lib/product-config';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const berkeleyMono = localFont({
  src: './BerkeleyMonoVariable.woff2',
  variable: '--font-berkeley-mono',
});

const firaMono = Fira_Code({
  weight: ['400'],
  variable: '--font-fira-mono',
  subsets: ['latin'],
});

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['400'],
  variable: '--font-ibm-plex-mono',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  weight: ['400'],
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  ...(process.env.NEXT_PUBLIC_SITE === 'diffshub' && { viewportFit: 'cover' }),
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

// Per-site branding (icons, OG/twitter) is set here explicitly so the
// dispatcher route at `app/page.tsx` (outside the route groups) inherits it.
const SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') as ProductId;
const SITE_PRODUCT = PRODUCTS[SITE];
const PROD_ORIGIN_BY_SITE: Record<ProductId, string> = {
  diffs: 'https://diffs.com',
  trees: 'https://trees.software',
  diffshub: 'https://diffshub.com',
};
const DEV_PORT_BY_SITE: Record<ProductId, string> = {
  diffs: '3690',
  trees: '3691',
  diffshub: '3692',
};
const PROD_ORIGIN = PROD_ORIGIN_BY_SITE[SITE];
// In dev, point `metadataBase` at localhost so OG previewers fetch
// in-progress assets instead of whatever's deployed.
const isDev = process.env.NODE_ENV !== 'production';
const DEV_PORT = process.env.PORT ?? DEV_PORT_BY_SITE[SITE];
const SITE_ORIGIN = isDev ? `http://localhost:${DEV_PORT}` : PROD_ORIGIN;
const baseTitle = `${SITE_PRODUCT.name}, from Pierre`;
const taggedTitle = `${WORKTREE_PREFIX}${baseTitle}`;
const description = SITE_PRODUCT.description;
const SITE_ICONS_BY_SITE: Record<ProductId, Metadata['icons']> = {
  diffs: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  trees: {
    icon: [
      { url: '/trees-brand/icon.svg', type: 'image/svg+xml' },
      { url: '/trees-brand/icon.ico', sizes: 'any' },
    ],
    apple: '/trees-brand/apple-icon.png',
  },
  diffshub: {
    icon: [
      { url: '/diffshub-brand/icon.svg', type: 'image/svg+xml' },
      { url: '/diffshub-brand/icon.png', type: 'image/png' },
    ],
    apple: '/diffshub-brand/apple-icon.png',
  },
};
const SITE_OG_IMAGE_BY_SITE: Record<ProductId, string> = {
  diffs: '/diffs-brand/opengraph-image.png',
  trees: '/trees-brand/opengraph-image.png',
  diffshub: '/diffshub-brand/opengraph-image.png',
};
const SITE_TWITTER_IMAGE_BY_SITE: Record<ProductId, string> = {
  diffs: '/diffs-brand/twitter-image.png',
  trees: '/trees-brand/twitter-image.png',
  diffshub: '/diffshub-brand/twitter-image.png',
};
const SITE_ICONS = SITE_ICONS_BY_SITE[SITE];
const SITE_OG_IMAGE = SITE_OG_IMAGE_BY_SITE[SITE];
const SITE_TWITTER_IMAGE = SITE_TWITTER_IMAGE_BY_SITE[SITE];
const themeBootstrapScript = `(${String(function applyInitialTheme() {
  try {
    const storedTheme = window.localStorage.getItem('theme');
    const theme =
      storedTheme === 'light' || storedTheme === 'dark'
        ? storedTheme
        : 'system';
    const resolvedTheme =
      theme === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    const root = document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  } catch {
    // Ignore storage/media failures and let CSS defaults apply.
  }
})})()`;

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

const WrapperContext = SITE === 'diffshub' ? WorkerPoolContext : Fragment;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${berkeleyMono.variable} ${geistSans.variable} ${geistMono.variable} ${firaMono.variable} ${ibmPlexMono.variable} ${jetbrainsMono.variable} ${inter.variable}`}
    >
      <head>
        <script
          id="docs-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body
      // className={
      //   SITE === 'diffshub' ? 'bg-neutral-50 dark:bg-neutral-900' : undefined
      // }
      >
        <WrapperContext>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
            <Toaster />
            <div
              id="dark-mode-portal-container"
              className="dark"
              data-theme="dark"
            ></div>
            <div
              id="light-mode-portal-container"
              className="light"
              data-theme="light"
            ></div>
          </ThemeProvider>
        </WrapperContext>
        <PreloadHighlighter />
      </body>
    </html>
  );
}
