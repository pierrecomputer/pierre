import { Geist } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { PreloadHighlighter } from '@/components/PreloadHighlighter';
import { ScrollbarGutterVariables } from '@/components/ScrollbarGutterVariables';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/Toaster';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const berkeleyMono = localFont({
  src: '../public/fonts/BerkeleyMonoVariable.woff2',
  variable: '--font-berkeley-mono',
});

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

    // Set the iOS navbar tint before first paint so it matches the resolved
    // mode immediately. The meta is created here (not authored in JSX, which
    // React 19 would hoist into a duplicate) and owned by JS thereafter.
    // Literals mirror SCHEME_THEME_COLOR in ThemeProvider.tsx (this stringified
    // script can't import it); keep them in sync.
    let themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta == null) {
      themeColorMeta = document.createElement('meta');
      themeColorMeta.setAttribute('name', 'theme-color');
      document.head.appendChild(themeColorMeta);
    }
    themeColorMeta.setAttribute(
      'content',
      resolvedTheme === 'dark' ? '#0a0a0a' : '#ffffff'
    );
  } catch {
    // Ignore storage/media failures and let CSS defaults apply.
  }
})})()`;

export function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${berkeleyMono.variable} ${geistSans.variable}`}
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
      <body className="diffshub">
        <ScrollbarGutterVariables />
        <WorkerPoolContext>
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
        </WorkerPoolContext>
        <PreloadHighlighter />
      </body>
    </html>
  );
}
