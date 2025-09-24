import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
};

const withMDX = createMDX({
  configPath: 'source.config.ts',
});

export default withMDX(nextConfig);
