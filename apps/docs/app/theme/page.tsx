import '@/app/prose.css';
import { preloadFile } from '@pierre/diffs/ssr';
import {
  IconArrowUpRight,
  IconBrandCursor,
  IconBrandVsCode,
  IconBrandZed,
  IconThemes,
} from '@pierre/icons';
import type { Metadata } from 'next';
import Link from 'next/link';

import { HeadingAnchors } from '../docs/HeadingAnchors';
import { ProseWrapper } from '../docs/ProseWrapper';
import {
  THEMING_PACKAGE_JSON_EXAMPLE,
  THEMING_PALETTE_COLORS,
  THEMING_PALETTE_LIGHT,
  THEMING_PALETTE_ROLES,
  THEMING_PROJECT_STRUCTURE,
  THEMING_REGISTER_THEME,
  THEMING_TOKEN_COLORS_EXAMPLE,
  THEMING_USE_IN_COMPONENT,
} from '../docs/Theming/constants';
import { ThemeDemo } from './ThemeDemo';
import { ThemeLayout } from './ThemeLayout';
import Footer from '@/components/Footer';
import { PierreCompanySection } from '@/components/PierreCompanySection';
import { Button } from '@/components/ui/button';
import { renderMDX } from '@/lib/mdx';

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

export default async function ThemePage() {
  const [
    projectStructurePreload,
    paletteColorsPreload,
    paletteRolesPreload,
    paletteLightPreload,
    tokenColorsExamplePreload,
    packageJsonExamplePreload,
    registerThemePreload,
    useInComponentPreload,
  ] = await Promise.all([
    preloadFile(THEMING_PROJECT_STRUCTURE),
    preloadFile(THEMING_PALETTE_COLORS),
    preloadFile(THEMING_PALETTE_ROLES),
    preloadFile(THEMING_PALETTE_LIGHT),
    preloadFile(THEMING_TOKEN_COLORS_EXAMPLE),
    preloadFile(THEMING_PACKAGE_JSON_EXAMPLE),
    preloadFile(THEMING_REGISTER_THEME),
    preloadFile(THEMING_USE_IN_COMPONENT),
  ]);

  // Merge href from constants into preloaded results
  const projectStructure = { ...projectStructurePreload };
  const paletteColors = {
    ...paletteColorsPreload,
    href: THEMING_PALETTE_COLORS.href,
  };
  const paletteRoles = {
    ...paletteRolesPreload,
    href: THEMING_PALETTE_ROLES.href,
  };
  const paletteLight = {
    ...paletteLightPreload,
    href: THEMING_PALETTE_LIGHT.href,
  };
  const tokenColorsExample = {
    ...tokenColorsExamplePreload,
    href: THEMING_TOKEN_COLORS_EXAMPLE.href,
  };
  const packageJsonExample = { ...packageJsonExamplePreload };
  const registerTheme = { ...registerThemePreload };
  const useInComponent = { ...useInComponentPreload };

  const content = await renderMDX({
    filePath: 'docs/Theming/content.mdx',
    scope: {
      projectStructure,
      paletteColors,
      paletteRoles,
      paletteLight,
      tokenColorsExample,
      packageJsonExample,
      registerTheme,
      useInComponent,
    },
  });

  const headerContent = (
    <>
      <section className="flex max-w-3xl flex-col gap-3 py-20 lg:max-w-4xl">
        <IconThemes className="mb-2 size-8" />
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

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
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
            <span className="text-muted-foreground">(Soon)</span>
          </Button>
        </div>
      </section>

      <section className="pb-6">
        <ThemeDemo />
      </section>
    </>
  );

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
      <ThemeLayout header={headerContent}>
        <div className="min-w-0 space-y-8">
          <HeadingAnchors />

          <ProseWrapper>{content}</ProseWrapper>

          <PierreCompanySection />
        </div>
      </ThemeLayout>

      <Footer />
    </div>
  );
}
