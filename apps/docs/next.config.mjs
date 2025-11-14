/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  experimental: {
    cssChunking: 'strict',
  },
};

export default nextConfig;
