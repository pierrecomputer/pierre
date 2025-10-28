import { createMDX } from 'fumadocs-mdx/next';

// const cspHeader = `
//     default-src 'self';
//     script-src 'self';
//     style-src 'self';
//     img-src 'self' blob: data:;
//     font-src 'self';
//     object-src 'none';
//     base-uri 'self';
//     form-action 'self';
//     frame-ancestors 'none';
//     upgrade-insecure-requests;
// `;

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Suppress Next.js's ESLint plugin detection warning during builds
    // The Next.js plugin is properly configured in the root eslint.config.js (flat config)
    // but Next.js doesn't recognize flat config format yet
    ignoreDuringBuilds: true,
  },
  // async headers() {
  //   return [
  //     {
  //       // Dont match yet, for noise reasons, but leave it since i'll do this soon
  //       source: '/ssr(.*)',
  //       headers: [
  //         {
  //           key: 'Content-Security-Policy-Report-Only',
  //           value: cspHeader.replace(/\n/g, ''),
  //         },
  //       ],
  //     },
  //   ];
  // },
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
