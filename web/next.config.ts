import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost', port: '9000', pathname: '/products/**' }],
  },
};

export default nextConfig;
