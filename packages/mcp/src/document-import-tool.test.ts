import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, test } from 'vitest';
import { AppError } from '@project-knowledge-hub/domain';
import {
  createKnowledgeHubMcpServer,
  type McpClientContext,
  type McpToolHandlers,
} from './server.js';
import { listHubToolSummaries } from './llm-tool-catalog.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const client: McpClientContext = {
  id: 'client',
  name: 'Client',
  organizationId: 'org',
  scopes: ['knowledge:write', 'knowledge:read'],
  allowedWorkspaceIds: [WORKSPACE_ID],
  actingUserId: '22222222-2222-4222-8222-222222222222',
  allowedProjectIds: [],
};

async function withClient(
  handlers: Partial<McpToolHandlers>,
  run: (mcp: Client) => Promise<void>,
) {
  const server = createKnowledgeHubMcpServer(client, handlers as McpToolHandlers);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: 'doc-import', version: '0' });
  await mcp.connect(clientTransport);
  try {
    await run(mcp);
  } finally {
    await mcp.close();
  }
}

describe('import_document_knowledge_record', () => {
  test('is listed for agents and stays off the ChatGPT OAuth scan', () => {
    const names = listHubToolSummaries(true).map((tool) => tool.name);
    expect(names).toContain('import_document_knowledge_record');
    const summary = listHubToolSummaries(true).find(
      (tool) => tool.name === 'import_document_knowledge_record',
    );
    expect(summary?.scope).toBe('knowledge:write');
    expect(summary?.description.length).toBeLessThan(400);
  });

  test('returns the created record from the handler', async () => {
    const importDocumentKnowledgeRecord = async () => ({
      documentImportId: '33333333-3333-4333-8333-333333333333',
      knowledgeRecord: {
        id: '44444444-4444-4444-8444-444444444444',
        humanKey: 'DOC-NOTE-1',
        key: 'DOC-NOTE-1',
        contentMarkdown: '# brief.pdf\n\nConverted body',
      },
    });
    await withClient({ importDocumentKnowledgeRecord }, async (mcp) => {
      const listed = await mcp.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain(
        'import_document_knowledge_record',
      );
      const result = await mcp.callTool({
        name: 'import_document_knowledge_record',
        arguments: {
          workspaceId: WORKSPACE_ID,
          filename: 'brief.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('pdf').toString('base64'),
        },
      });
      expect(result.isError).toBeFalsy();
      const text = result.content.find((block) => block.type === 'text');
      expect(text && 'text' in text ? text.text : '').toContain('DOC-NOTE-1');
      expect(text && 'text' in text ? text.text : '').toContain('Converted body');
    });
  });

  test('surfaces a typed validation error', async () => {
    const importDocumentKnowledgeRecord = async () => {
      throw new AppError({
        code: 'DOCUMENT_IMPORT_TYPE_UNSUPPORTED',
        message:
          'DOCUMENT_IMPORT_TYPE_UNSUPPORTED: Unsupported document type (use PDF, DOCX, PPTX, XLSX, HTML, Markdown, or text)',
        statusCode: 400,
      });
    };
    await withClient({ importDocumentKnowledgeRecord }, async (mcp) => {
      const result = await mcp.callTool({
        name: 'import_document_knowledge_record',
        arguments: {
          workspaceId: WORKSPACE_ID,
          filename: 'notes.exe',
          contentType: 'application/octet-stream',
          contentBase64: Buffer.from('x').toString('base64'),
        },
      });
      expect(result.isError).toBe(true);
      const text = result.content.find((block) => block.type === 'text');
      const body = text && 'text' in text ? text.text : '';
      expect(body).toContain('DOCUMENT_IMPORT_TYPE_UNSUPPORTED');
      expect(body).toContain('Unsupported document type');
    });
  });
});
