import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer NEXT_REWRITE_API_ORIGIN (Docker build) so a host/Dokploy API_URL=localhost
// cannot bake broken rewrites into the web image.
const apiUrl =
  process.env.NEXT_REWRITE_API_ORIGIN ??
  process.env.API_URL ??
  'http://localhost:3101';
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const mcpSchemasPath = path.join(
  __dirname,
  '../../packages/mcp/src/llm-client-schemas.ts',
);

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  poweredByHeader: false,
  transpilePackages: [
    '@project-knowledge-hub/markdown',
    '@project-knowledge-hub/mcp',
  ],
  turbopack: {
    resolveAlias: {
      '@project-knowledge-hub/mcp/schemas': mcpSchemasPath,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@project-knowledge-hub/mcp/schemas': mcpSchemasPath,
    };
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
      {
        source: '/mcp',
        destination: `${apiUrl}/mcp`,
      },
      {
        source: '/mcp/:path*',
        destination: `${apiUrl}/mcp/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
