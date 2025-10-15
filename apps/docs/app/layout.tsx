// sort-imports-ignore
import { RootProvider } from 'fumadocs-ui/provider';
import type { Metadata } from 'next';
import {
  Fira_Code,
  Geist,
  Geist_Mono,
  Google_Sans_Code,
  IBM_Plex_Mono,
  JetBrains_Mono,
} from 'next/font/google';
import './globals.css';
// import '../styles/tokens.css';

import { Toaster } from '@/components/ui/sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
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

const googleSansCode = Google_Sans_Code({
  weight: ['400'],
  variable: '--font-google-sans-code',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Pierre JS Docs',
  description: 'Its docs for it!',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        style={
          {
            // display: 'flex',
            // flexDirection: 'column',
            // minHeight: '100vh',
          }
        }
        className={`${geistSans.variable} ${geistMono.variable} ${firaMono.variable} ${ibmPlexMono.variable} ${jetbrainsMono.variable} ${googleSansCode.variable}`}
      >
        <RootProvider>
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
        </RootProvider>
      </body>
    </html>
  );
}
