import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next.config.mts: Next 16 compiles next.config.ts as CJS; import.meta then
// yields "exports is not defined in ES module scope". Use .mts + import.meta.dirname.
const configDir = import.meta.dirname;
// Prefer NEXT_REWRITE_API_ORIGIN (Docker build) so a host/Dokploy API_URL=localhost
// cannot bake broken rewrites into the web image.
const apiUrl =
  process.env.NEXT_REWRITE_API_ORIGIN ??
  process.env.API_URL ??
  'http://localhost:3101';
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const mcpSchemasPath = path.join(
  configDir,
  '../../packages/mcp/src/llm-client-schemas.ts',
);
// Turbopack treats absolute alias targets as server-relative (`./home/...`) and
// fails. It also cannot rewrite sibling `.js` → `.ts` imports the way webpack
// extensionAlias does, so point Turbopack at the built MCP schemas entry.
const mcpSchemasDistRel = '../../packages/mcp/dist/llm-client-schemas.js';
const d3PathAliasRel = '../../node_modules/d3-path/src/index.js';
const d3ShapeAliasRel = '../../node_modules/d3-shape/src/index.js';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(configDir, '../..'),
  poweredByHeader: false,
  // Soft navigations must not serve stale RSC payloads for catalogue lists.
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 30,
    },
    // Rewrites to the API use http-proxy with a 30s default. AI translate/OCR
    // often exceeds that (local Ollama can take 60–120s+) and Next then returns
    // plain-text "Internal Server Error" (HTTP 500) → UI non-JSON errors.
    // Align with typical LLM provider timeoutMs (up to 10 minutes in Admin).
    proxyTimeout: 600_000,
  },
  transpilePackages: [
    '@project-knowledge-hub/markdown',
    '@project-knowledge-hub/mcp',
  ],
  // Keep Mermaid (and its d3 deps) out of the RSC/server graph — dynamic client import only.
  serverExternalPackages: ['mermaid', 'cytoscape', 'cytoscape-fcose', 'cose-base'],
  turbopack: {
    resolveAlias: {
      // Prefer dist so sibling `.js` imports resolve; overrides tsconfig → src.
      '@project-knowledge-hub/mcp/schemas': mcpSchemasDistRel,
      // Pin mermaid/d3 to v3 src (relative paths — absolute breaks Turbopack).
      'd3-path': d3PathAliasRel,
      'd3-shape': d3ShapeAliasRel,
    },
  },
  // Mermaid/d3 named ESM re-exports still need Webpack aliases. Next 16 defaults
  // to Turbopack for `next build`; keep `--webpack` in package.json until these
  // aliases are ported fully to `turbopack.resolveAlias`.
  webpack: (config) => {
    // mcp/schemas aliases to TypeScript sources; sibling ESM imports use `.js`
    // (e.g. ./llm-tool-catalog.js → llm-tool-catalog.ts).
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      '@project-knowledge-hub/mcp/schemas': mcpSchemasPath,
      // Webpack fails named ESM re-exports from the d3 umbrella (mermaid → d3).
      // Pin to d3-shape/d3-path v3 src (pnpm overrides keep these off d3-sankey's 1.x).
      'd3-path': path.resolve(configDir, d3PathAliasRel),
      'd3-shape': path.resolve(configDir, d3ShapeAliasRel),
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
