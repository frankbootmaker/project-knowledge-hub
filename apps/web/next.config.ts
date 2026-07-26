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
  // Soft navigations must not serve stale RSC payloads for catalogue lists.
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
  },
  transpilePackages: [
    '@project-knowledge-hub/markdown',
    '@project-knowledge-hub/mcp',
  ],
  // Keep Mermaid (and its d3 deps) out of the RSC/server graph — dynamic client import only.
  serverExternalPackages: ['mermaid', 'cytoscape', 'cytoscape-fcose', 'cose-base'],
  turbopack: {
    resolveAlias: {
      '@project-knowledge-hub/mcp/schemas': mcpSchemasPath,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@project-knowledge-hub/mcp/schemas': mcpSchemasPath,
      // Webpack sometimes fails named ESM re-exports from d3-path (mermaid → d3-shape).
      'd3-path': path.resolve(__dirname, '../../node_modules/d3-path/src/index.js'),
      'd3-shape': path.resolve(__dirname, '../../node_modules/d3-shape/src/index.js'),
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
