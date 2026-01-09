import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import {
  IconArrowUpRight,
  IconBrandCursor,
  IconBrandVsCode,
  IconBrandZed,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ThemeScreenshots } from './ThemeScreenshots';

export const metadata: Metadata = {
  title: 'Pierre Themes — Themes for Visual Studio Code, Cursor, and Shiki.',
  description:
    'Beautiful light and dark themes, generated from a shared color palette, for Visual Studio Code, Cursor, and Shiki.',
  openGraph: {
    title: 'Pierre Themes — Themes for Visual Studio Code, Cursor, and Shiki.',
    description:
      'Beautiful light and dark themes, generated from a shared color palette, for Visual Studio Code, Cursor, and Shiki.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pierre Themes — Themes for Visual Studio Code, Cursor, and Shiki.',
    description:
      'Beautiful light and dark themes, generated from a shared color palette, for Visual Studio Code, Cursor, and Shiki.',
  },
};

export default function ThemePage() {
  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <Header className="-mb-[1px]" />

      <section className="flex max-w-3xl flex-col gap-3 py-20 lg:max-w-4xl">
        <div className="mb-2 flex gap-2">
          <div className="size-4 rounded-full bg-[#fc2b73] dark:bg-[#ff678d]" />
          <div className="size-4 w-8 rounded-full bg-[#0dbe4e] dark:bg-[#5ecc71]" />
          <div className="size-4 w-12 rounded-full bg-[#00cab1] dark:bg-[#61d5c0]" />
          <div className="size-4 w-20 rounded-full bg-[#7b43f8] dark:bg-[#9d6afb]" />
          <div className="size-4 w-8 rounded-full bg-[#fe8c2c] dark:bg-[#ffa359]" />
          <div className="size-4 w-6 rounded-full bg-[#009fff] dark:bg-[#69b1ff]" />
        </div>

        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
          Pierre themes
        </h1>
        <p className="text-md text-muted-foreground mb-2 max-w-[740px] text-pretty md:text-lg lg:text-xl">
          Beautiful light and dark themes, generated from a shared color
          palette, for Visual Studio Code, Cursor, and Shiki. Built first for{' '}
          <Link
            href="https://diffs.com"
            target="_blank"
            className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
          >
            <code>@pierre/diffs</code>
          </Link>
          , and shared with the community by{' '}
          <Link
            target="_blank"
            href="https://pierre.computer"
            className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
          >
            The Pierre Computer Company
          </Link>
          .
        </p>

        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link
              href="https://marketplace.visualstudio.com/items?itemName=pierrecomputer.pierre-theme"
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconBrandVsCode />
              Visual Studio Code
              <IconArrowUpRight />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link
              href="https://open-vsx.org/extension/pierrecomputer/pierre-theme"
              target="_blank"
              rel="noopener noreferrer"
            >
              <IconBrandCursor />
              Cursor
              <IconArrowUpRight />
            </Link>
          </Button>
          <Button variant="outline" disabled className="opacity-50">
            <IconBrandZed />
            Zed
            <span className="text-muted-foreground text-xs">(Soon)</span>
          </Button>
        </div>
      </section>

      <section className="py-6">
        <ThemeScreenshots />
      </section>

      <section className="space-y-4 py-6">
        <h2 className="text-2xl font-medium">Usage</h2>

        <ol className="list-inside list-decimal space-y-2">
          <li>
            Install the Pierre theme pack from your editor’s extension
            marketplace.
            <ul className="mt-2 list-['—'] space-y-2 pl-8">
              <li className="pl-[1.25ch]">
                <Link
                  href="https://marketplace.visualstudio.com/items?itemName=pierrecomputer.pierre-theme"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
                >
                  Visual Studio Code
                </Link>
              </li>
              <li className="pl-[1.25ch]">
                <Link
                  href="https://open-vsx.org/extension/pierrecomputer/pierre-theme"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
                >
                  Cursor
                </Link>
              </li>
              <li className="pl-[1.25ch] opacity-50">Zed (coming soon)</li>
            </ul>
          </li>
          <li>
            Open your editor and select the Pierre themes in settings or the
            command palette.
          </li>
        </ol>
      </section>

      <PierreCompanySection />

      <Footer />
    </div>
  );
}
