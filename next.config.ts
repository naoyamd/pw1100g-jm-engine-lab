import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  assetPrefix:
    process.env.GITHUB_PAGES === 'true' ? '/pw1100g-jm-engine-lab' : '',
  trailingSlash: true,
};

export default nextConfig;
