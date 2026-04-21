// sort-imports-ignore
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from 'next-themes';
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
import { type ProductId, PRODUCTS } from './product-config';
import { PreloadHighlighter } from '@/components/PreloadHighlighter';
import { Toaster } from '@/components/ui/sonner';

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

// Same Next.js app deploys to two domains based on `NEXT_PUBLIC_SITE`
// (see `next.config.mjs`). Brand strings here switch on the env var so
// unmatched routes (404s, `/_not-found`, etc.) render brand-correct
// titles/descriptions/OG cards on each domain.
//
// Icons:
// - On `diffs.com`, the root declares the favicon set explicitly; it
//   serves Diffs content at `/`, `/docs`, `/theme`, `/playground`, and
//   redirects `/trees/*` out.
// - On `trees.software`, the root deliberately does NOT declare `icons`
//   so the file-convention assets in `app/trees/` (`icon.{ico,svg}`,
//   `apple-icon.png`) take over for the actual rendered routes (all of
//   which sit under `/trees/*` because of the `next.config.mjs`
//   rewrites).
const SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') as ProductId;
const isTrees = SITE === 'trees';
const SITE_PRODUCT = PRODUCTS[SITE];
const SITE_ORIGIN = isTrees ? 'https://trees.software' : 'https://diffs.com';
const baseTitle = `${SITE_PRODUCT.name}, from Pierre`;
const taggedTitle = `${WORKTREE_PREFIX}${baseTitle}`;
const description = SITE_PRODUCT.description;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: taggedTitle,
    template: `${WORKTREE_PREFIX}%s`,
  },
  description,
  ...(isTrees
    ? {}
    : {
        icons: {
          icon: [
            { url: '/favicon.svg', type: 'image/svg+xml' },
            { url: '/favicon.png', type: 'image/png' },
          ],
          apple: '/apple-touch-icon.png',
        },
      }),
  openGraph: {
    title: {
      default: taggedTitle,
      template: `${WORKTREE_PREFIX}%s`,
    },
    description,
  },
  twitter: {
    card: 'summary_large_image',
    title: {
      default: taggedTitle,
      template: `${WORKTREE_PREFIX}%s`,
    },
    description,
  },
};

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
      <body>
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
        <PreloadHighlighter />
      </body>
    </html>
  );
}
