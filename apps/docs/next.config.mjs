import createMDX from '@next/mdx';
import remarkGfm from 'remark-gfm';

import rehypeHierarchicalSlug from './lib/rehype-hierarchical-slug.ts';
import remarkTocIgnore from './lib/remark-toc-ignore.ts';

// Turbopack doesn't support non-serializable options (functions) in loaders
// Detect if we're using Turbopack and skip custom plugins if so
const isTurbopack = process.argv.some((arg) => arg.includes('--turbopack'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  experimental: {
    cssChunking: 'strict',
  },
  pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
};

const withMDX = createMDX(
  isTurbopack
    ? {}
    : {
        options: {
          remarkPlugins: [remarkGfm, remarkTocIgnore],
          rehypePlugins: [[rehypeHierarchicalSlug, { levels: [2, 3, 4] }]],
        },
      }
);

export default withMDX(nextConfig);
