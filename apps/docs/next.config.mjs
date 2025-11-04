import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Suppress Next.js's ESLint plugin detection warning during builds
    // The Next.js plugin is properly configured in the root eslint.config.js (flat config)
    // but Next.js doesn't recognize flat config format yet
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      {
        source: '/fumadocs/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
      {
        source: '/fumadocs/:path*.md',
        destination: '/llms.mdx/:path*',
      },
    ];
  },
  experimental: {
    cssChunking: 'strict',
    reactCompiler: true,
  },
};

const withMDX = createMDX({
  configPath: 'source.config.ts',
});

export default withMDX(nextConfig);
