const site = process.env.NEXT_PUBLIC_SITE ?? 'diffs';
const isTrees = site === 'trees';
const isDev = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  devIndicators: false,
  experimental: {
    cssChunking: 'strict',
  },
  // allowedDevOrigins: [],
  // Resolve and transpile workspace packages so subpath exports (e.g. @pierre/trees/react)
  // resolve correctly when Next follows client-component imports from the server.
  transpilePackages: ['@pierre/trees', '@pierre/diffs', '@pierre/truncate'],
  // Opt the path-store-powered route out of bfcache / HTTP document caching.
  // iOS Safari kills tabs that briefly hold two copies of the 1.6M-path AOSP
  // tree during a refresh; no-store tells the browser to fully release the old
  // document before it starts booting the new one.
  headers() {
    return [
      {
        source: '/trees-dev/path-store-powered',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ];
  },
  rewrites() {
    if (!isTrees) {
      return [];
    }
    // On the trees site, serve tree pages at the root.
    return {
      beforeFiles: [
        { source: '/', destination: '/trees' },
        { source: '/docs', destination: '/trees/docs' },
      ],
    };
  },
  redirects() {
    if (isTrees) {
      // Canonicalize /trees → / and /trees/docs → /docs on the trees site.
      return [
        {
          source: '/trees',
          destination: '/',
          permanent: true,
        },
        {
          source: '/trees/docs',
          destination: '/docs',
          permanent: true,
        },
      ];
    }
    // In dev both products are served locally; skip external redirects.
    if (isDev) {
      return [];
    }
    // On the diffs site in production, redirect /trees paths to the external trees domain.
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
  },
  turbopack: {
    resolveAlias: {
      '@pierre/truncate/style.css': '../../packages/truncate/src/style.css',
    },
  },
};

export default nextConfig;
