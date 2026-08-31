import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Geist } from 'next/font/google';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { PreloadHighlighter } from '@/components/PreloadHighlighter';
import { ScrollbarGutterVariables } from '@/components/ScrollbarGutterVariables';
import { ThemeProvider } from '@/components/ThemeProvider';
import { Toaster } from '@/components/Toaster';
import { WorkerPoolContext } from '@/components/WorkerPoolContext';
import {
  THEME_BOOTSTRAP_RULE_ID,
  THEME_BOOTSTRAP_SELECTOR,
  THEME_BOOTSTRAP_STORAGE_KEY,
  THEME_BOOTSTRAP_VERSION,
  type ThemeBootstrapCache,
} from '@/lib/theme/themeBootstrap';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const berkeleyMono = localFont({
  src: '../public/fonts/BerkeleyMonoVariable.woff2',
  variable: '--font-berkeley-mono',
});

function applyInitialTheme(
  bootstrapStorageKey: string,
  bootstrapVersion: number,
  ruleId: string,
  selector: string
) {
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

    const selectedThemeName = window.localStorage.getItem(
      resolvedTheme === 'dark' ? 'diffshub-dark-theme' : 'diffshub-light-theme'
    );
    let bootstrapStyle: Record<string, string> | undefined;
    const storedBootstrap = window.localStorage.getItem(bootstrapStorageKey);
    if (selectedThemeName != null && storedBootstrap != null) {
      try {
        const parsed = JSON.parse(
          storedBootstrap
        ) as Partial<ThemeBootstrapCache>;
        const entry = parsed[resolvedTheme];
        if (
          parsed.version === bootstrapVersion &&
          entry?.themeName === selectedThemeName &&
          entry.style != null &&
          typeof entry.style === 'object' &&
          !Array.isArray(entry.style)
        ) {
          bootstrapStyle = entry.style;
        }
      } catch {
        // Ignore malformed cached chrome and use the built-in theme.
      }
    }

    if (bootstrapStyle != null) {
      const bootstrapElement = document.createElement('style');
      bootstrapElement.id = ruleId;
      document.head.appendChild(bootstrapElement);
      const sheet = bootstrapElement.sheet;
      if (sheet != null) {
        const index = sheet.insertRule(`${selector} {}`, 0);
        const rule = sheet.cssRules[index] as CSSStyleRule;
        for (const [property, value] of Object.entries(bootstrapStyle)) {
          if (typeof value === 'string')
            rule.style.setProperty(property, value);
        }
      }
    }

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
}

const themeBootstrapScript = `(${String(applyInitialTheme)})(${JSON.stringify(THEME_BOOTSTRAP_STORAGE_KEY)},${THEME_BOOTSTRAP_VERSION},${JSON.stringify(THEME_BOOTSTRAP_RULE_ID)},${JSON.stringify(THEME_BOOTSTRAP_SELECTOR)})`;

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
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
