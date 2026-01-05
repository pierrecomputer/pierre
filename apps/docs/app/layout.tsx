// sort-imports-ignore
import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import {
  Fira_Code,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  JetBrains_Mono,
} from 'next/font/google';
import localFont from 'next/font/local';

import './globals.css';

import { Toaster } from '@/components/ui/sonner';

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

export const metadata: Metadata = {
  title: 'Diffs, from Pierre',
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
    title: 'Diffs, from Pierre',
    description:
      'An open source diff and file rendering library by The Pierre Computer Company.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Diffs, from Pierre',
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
      className={`${berkeleyMono.variable} ${geistSans.variable} ${geistMono.variable} ${firaMono.variable} ${ibmPlexMono.variable} ${jetbrainsMono.variable}`}
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
      </body>
    </html>
  );
}
