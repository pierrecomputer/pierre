import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/docs/:path*.mdx',
        destination: '/llms.mdx/:path*',
      },
      {
        source: '/docs/:path*.md',
        destination: '/llms.mdx/:path*',
      },
    ];
  },
  turbopack: {
    rules: {
      '*.txt': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
      '../../packages/diff-ui/src/style.css': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
    },
  },
  // NOTE(amadeus): Pretty sure we don't need this, but keeping it around just
  // in case
  // webpack: (config) => {
  //   config.module.rules.push({
  //     test: /\.txt$/,
  //     use: 'raw-loader',
  //   });
  //   // For specific CSS file with ?raw query parameter
  //   config.module.rules.push({
  //     resourceQuery: /raw/,
  //     test: /packages\/diff-ui\/src\/style\.css$/,
  //     type: 'asset/source',
  //   });
  //   return config;
  // },
  experimental: {
    cssChunking: 'strict',
  },
};

const withMDX = createMDX({
  configPath: 'source.config.ts',
});

export default withMDX(nextConfig);
