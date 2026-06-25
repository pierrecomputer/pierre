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
import { PreloadHighlighter } from '@/components/PreloadHighlighter';
import { ScrollbarGutterVariables } from '@/components/ScrollbarGutterVariables';
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
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#252525' },
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

// Per-site branding (icons, OG/twitter) is set here explicitly so the
// dispatcher route at `app/page.tsx` (outside the route groups) inherits it.
const SITE = (process.env.NEXT_PUBLIC_SITE ?? 'diffs') as ProductId;
const SITE_PRODUCT = PRODUCTS[SITE];
const PROD_ORIGIN_BY_SITE: Record<ProductId, string> = {
  diffs: 'https://diffs.com',
  trees: 'https://trees.software',
};
const DEV_PORT_BY_SITE: Record<ProductId, string> = {
  diffs: '3690',
  trees: '3691',
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
      { url: '/diffs-brand/icon.svg', type: 'image/svg+xml' },
      { url: '/diffs-brand/icon.ico', sizes: '32x32' },
    ],
    apple: '/diffs-brand/apple-icon.png',
  },
  trees: {
    icon: [
      { url: '/trees-brand/icon.svg', type: 'image/svg+xml' },
      { url: '/trees-brand/icon.ico', sizes: '32x32' },
    ],
    apple: '/trees-brand/apple-icon.png',
  },
};
const SITE_OG_IMAGE_BY_SITE: Record<ProductId, string> = {
  diffs: '/diffs-brand/opengraph-image.png',
  trees: '/trees-brand/opengraph-image.png',
};
const SITE_TWITTER_IMAGE_BY_SITE: Record<ProductId, string> = {
  diffs: '/diffs-brand/twitter-image.png',
  trees: '/trees-brand/twitter-image.png',
};
const SITE_ICONS = SITE_ICONS_BY_SITE[SITE];
const SITE_OG_IMAGE = SITE_OG_IMAGE_BY_SITE[SITE];
const SITE_TWITTER_IMAGE = SITE_TWITTER_IMAGE_BY_SITE[SITE];
const themeBootstrapScript = `(${String(function applyInitialTheme() {
  try {
    const storedColorMode = window.localStorage.getItem('theme');
    const colorMode =
      storedColorMode === 'light' || storedColorMode === 'dark'
        ? storedColorMode
        : 'system';
    const resolvedColorScheme =
      colorMode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : colorMode;
    const root = document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(resolvedColorScheme);
    root.style.colorScheme = resolvedColorScheme;

    // Set the iOS navbar tint before first paint so it matches the resolved
    // mode immediately. The meta is created here (not authored in JSX, which
    // React 19 would hoist into a duplicate) and owned by JS thereafter.
    // Literals mirror MODE_THEME_COLOR in theme-provider.tsx (this stringified
    // script can't import it); keep them in sync.
    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta == null) {
      themeColorMeta = document.createElement('meta');
      themeColorMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.setAttribute(
      'content',
      resolvedColorScheme === 'dark' ? '#0a0a0a' : '#ffffff'
    );
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
        {/* The iOS navbar tint <meta name="theme-color"> is created and
            managed entirely by the bootstrap script below (and ThemeProvider),
            not authored here — React 19 hoists head tags and would leave a
            duplicate it manages alongside ours. */}
        <script
          id="docs-theme-bootstrap"
          dangerouslySetInnerHTML={{ __html: themeBootstrapScript }}
        />
      </head>
      <body className={SITE}>
        <ScrollbarGutterVariables />
        <ThemeProvider attribute="class">
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
