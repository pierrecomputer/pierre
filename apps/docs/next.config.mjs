/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  devIndicators: false,
  experimental: {
    cssChunking: 'strict',
  },
  // allowedDevOrigins: [],
  // The path-store-powered demo reads this LFS-backed fixture at request time
  // via fs.readFile; Next's file tracing can't detect that, so ship it
  // explicitly alongside the serverless bundle.
  outputFileTracingIncludes: {
    '/trees-dev/path-store-powered': [
      '../../packages/tree-test-data/aosp-files.json',
    ],
  },
  // Resolve and transpile workspace packages so subpath exports (e.g. @pierre/trees/react)
  // resolve correctly when Next follows client-component imports from the server.
  transpilePackages: ['@pierre/trees', '@pierre/diffs', '@pierre/truncate'],
  turbopack: {
    resolveAlias: {
      '@pierre/truncate/style.css': '../../packages/truncate/src/style.css',
    },
  },
};

export default nextConfig;
