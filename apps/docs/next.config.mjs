/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Suppress Next.js's ESLint plugin detection warning during builds
    // The Next.js plugin is properly configured in the root eslint.config.js (flat config)
    // but Next.js doesn't recognize flat config format yet
    ignoreDuringBuilds: true,
  },

  experimental: {
    cssChunking: 'strict',
    reactCompiler: true,
  },
};

export default nextConfig;
