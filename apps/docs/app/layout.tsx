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
const baseTitle = 'Diffs, from Pierre';
const taggedTitle = `${WORKTREE_PREFIX}${baseTitle}`;

export const metadata: Metadata = {
  title: taggedTitle,
  description:
    'An open source diff and file rendering library by The Pierre Computer Company.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.png', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.ico',
  },
  openGraph: {
    title: taggedTitle,
    description:
      'An open source diff and file rendering library by The Pierre Computer Company.',
  },
  twitter: {
    card: 'summary_large_image',
    title: taggedTitle,
    description:
      'An open source diff and file rendering library by The Pierre Computer Company.',
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
