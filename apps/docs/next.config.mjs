import { loadWorktreeEnv } from '../../scripts/load-worktree-env.mjs';

// `next dev` runs under Node, which (like Bun) only auto-loads the standard
// `.env*` names. Our worktree helper writes `PIERRE_WORKTREE_SLUG` /
// `PIERRE_PORT_OFFSET` into `.env.worktree` at the worktree root, so pull
// those in manually before Next inspects `process.env`. moon tasks load the
// same file via their envFile option; the loader preserves existing values.
loadWorktreeEnv();

// The browser title prefix (see `app/layout.tsx`) reads
// `NEXT_PUBLIC_WORKTREE_SLUG` so the value survives into the client bundle.
// Bridge it from the non-prefixed worktree slug so `.env.worktree` stays the
// single source of truth.
if (
  process.env.PIERRE_WORKTREE_SLUG &&
  !process.env.NEXT_PUBLIC_WORKTREE_SLUG
) {
  process.env.NEXT_PUBLIC_WORKTREE_SLUG = process.env.PIERRE_WORKTREE_SLUG;
}

const site = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = site === 'trees';
const isDiffs = !isTrees;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Each site variant gets its own build dir wherever both variants share a
  // workspace. Dev needs it so `dev-diffs` and `dev-trees` can run
  // concurrently (Next 16's dev lockfile is per-directory, not per-port);
  // local/CI builds need it so the two site builds can run in parallel and
  // be cached independently. On Vercel each project builds exactly one site
  // in an isolated container AND the Next builder collects output from the
  // literal `.next` (it does not honor an env-dependent distDir when
  // locating routes-manifest.json), so use the default there.
  distDir: process.env.VERCEL ? '.next' : `.next/${site}`,
  reactStrictMode: true,
  reactCompiler: true,
  devIndicators: false,
  experimental: {
    cssChunking: 'strict',
  },
  // allowedDevOrigins: [],
  // Resolve and transpile workspace packages so subpath exports (e.g. @pierre/trees/react)
  // resolve correctly when Next follows client-component imports from the server.
  transpilePackages: ['@pierre/trees', '@pierre/diffs', '@pierre/truncate'],
  // Opt the /trees-dev route out of bfcache / HTTP document caching.
  // iOS Safari kills tabs that briefly hold two copies of the 1.6M-path AOSP
  // tree during a refresh; no-store tells the browser to fully release the old
  // document before it starts booting the new one.
  headers() {
    return [
      {
        source: '/trees-dev',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ];
  },
  redirects() {
    if (isTrees) {
      // Trees content now lives at `/`, so the old `/trees` URLs are obsolete
      // on this site. Redirect any incoming legacy links to the canonical
      // location. `/new` is a long-standing alias kept for memorability.
      return [
        { source: '/trees', destination: '/', permanent: true },
        { source: '/trees/docs', destination: '/docs', permanent: true },
        { source: '/trees/:path*', destination: '/:path*', permanent: true },
        { source: '/new', destination: '/', permanent: true },
      ];
    }
    if (isDiffs) {
      // On the diffs site, anything that used to live under `/trees` belongs
      // to the trees site now hosted on a separate domain.
      return [
        {
          source: '/trees/:path*',
          destination: 'https://trees.software/:path*',
          permanent: false,
        },
        {
          source: '/trees',
          destination: 'https://trees.software',
          permanent: false,
        },
      ];
    }
    return [];
  },
  turbopack: {
    resolveAlias: {
      '@pierre/truncate/style.css': '../../packages/truncate/src/style.css',
    },
  },
};

export default nextConfig;
