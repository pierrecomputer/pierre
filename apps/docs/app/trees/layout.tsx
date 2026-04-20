import type { Metadata } from 'next';

// Clear the root layout's `metadata.icons` so Next.js falls back to the
// file-based conventions colocated with this segment (`icon.ico` and
// `apple-icon.png` in `app/trees/`). Without this override, the explicit
// `icons` object in the root layout takes precedence and the trees-specific
// icons are dropped from the head.
export const metadata: Metadata = {
  icons: null,
};

export default function TreesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
