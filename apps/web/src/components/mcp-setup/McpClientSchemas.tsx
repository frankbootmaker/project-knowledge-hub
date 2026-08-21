'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  buildAntigravityMcpConfig,
  buildAntigravitySetupSteps,
  buildChatGptActionsMeta,
  buildClaudeAiConnectorMeta,
  buildClaudeMcpConfig,
  buildClaudeSetupSteps,
  buildCopilotMcpSwagger,
  buildCursorMcpConfig,
  buildGeminiFunctionDeclarations,
  buildGeminiMcpConfig,
  buildLlmOpenApiDocument,
  buildOpenWebUiMcpConfig,
  buildOpenWebUiOpenApiConfig,
  stringifySchema,
} from '@project-knowledge-hub/mcp/schemas';
import { Button, useToast } from '../ui';

export const LLM_CLIENTS = [
  'cursor',
  'chatgpt',
  'claude',
  'antigravity',
  'gemini',
  'copilot',
  'openwebui',
] as const;

export type LlmClientId = (typeof LLM_CLIENTS)[number];

type SchemaPane = {
  id: string;
  labelKey: string;
  value: string;
};

export function defaultClientName(client: LlmClientId): string {
  switch (client) {
    case 'cursor':
      return 'Cursor local';
    case 'chatgpt':
      return 'ChatGPT Actions';
    case 'claude':
      return 'Claude';
    case 'antigravity':
      return 'Antigravity CLI';
    case 'gemini':
      return 'Gemini API';
    case 'copilot':
      return 'Microsoft Copilot';
    case 'openwebui':
      return 'OpenWebUI';
    default: {
      const _exhaustive: never = client;
      return _exhaustive;
    }
  }
}

export function LlmClientPicker({
  value,
  onChange,
}: {
  value: LlmClientId;
  onChange: (client: LlmClientId) => void;
}) {
  const t = useTranslations('admin');

  return (
    <div className="grid gap-3">
      <div>
        <p className="m-0 text-sm font-medium">{t('mcpWizardTargetClient')}</p>
        <p className="mt-1 mb-0 text-xs text-ink-muted">{t('mcpWizardTargetClientHint')}</p>
      </div>
      <div
        className="kh-ops-setup-grid"
        role="radiogroup"
        aria-label={t('mcpWizardTargetClient')}
      >
        {LLM_CLIENTS.map((id, index) => {
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`kh-ops-setup-card${active ? ' selected' : ''}`}
              onClick={() => onChange(id)}
            >
              <div className="kh-ops-card-body">
                <span className="kh-ops-setup-step">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3>{t(`mcpWizardClient_${id}`)}</h3>
                <p>{t(`mcpWizardClientBlurb_${id}`)}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function panesForClient(
  client: LlmClientId,
  options: { mcpUrl: string; token: string; includeWriteTools: boolean },
): SchemaPane[] {
  switch (client) {
    case 'cursor':
      return [
        {
          id: 'cursor-mcp',
          labelKey: 'mcpWizardSchema_cursorMcp',
          value: stringifySchema(buildCursorMcpConfig(options)),
        },
      ];
    case 'chatgpt': {
      const meta = buildChatGptActionsMeta(options);
      return [
        {
          id: 'chatgpt-openapi',
          labelKey: 'mcpWizardSchema_chatgptOpenApi',
          value: stringifySchema(buildLlmOpenApiDocument(options)),
        },
        {
          id: 'chatgpt-auth',
          labelKey: 'mcpWizardSchema_chatgptAuth',
          value: stringifySchema({
            authentication: meta.authType,
            openApiUrl: meta.openApiUrl,
            authorizationHeader: meta.authHeader,
          }),
        },
      ];
    }
    case 'claude': {
      const connector = buildClaudeAiConnectorMeta(options);
      return [
        {
          id: 'claude-steps',
          labelKey: 'mcpWizardSchema_claudeSteps',
          value: buildClaudeSetupSteps(options),
        },
        {
          id: 'claude-mcp',
          labelKey: 'mcpWizardSchema_claudeMcp',
          value: stringifySchema(buildClaudeMcpConfig(options)),
        },
        {
          id: 'claude-connector',
          labelKey: 'mcpWizardSchema_claudeConnector',
          value: stringifySchema(connector),
        },
      ];
    }
    case 'antigravity':
      return [
        {
          id: 'antigravity-steps',
          labelKey: 'mcpWizardSchema_antigravitySteps',
          value: buildAntigravitySetupSteps(options),
        },
        {
          id: 'antigravity-mcp',
          labelKey: 'mcpWizardSchema_antigravityMcp',
          value: stringifySchema(buildAntigravityMcpConfig(options)),
        },
      ];
    case 'gemini':
      return [
        {
          id: 'gemini-mcp',
          labelKey: 'mcpWizardSchema_geminiMcp',
          value: stringifySchema(buildGeminiMcpConfig(options)),
        },
        {
          id: 'gemini-openapi',
          labelKey: 'mcpWizardSchema_geminiOpenApi',
          value: stringifySchema(buildLlmOpenApiDocument(options)),
        },
        {
          id: 'gemini-functions',
          labelKey: 'mcpWizardSchema_geminiFunctions',
          value: stringifySchema(buildGeminiFunctionDeclarations(options)),
        },
      ];
    case 'copilot':
      return [
        {
          id: 'copilot-swagger',
          labelKey: 'mcpWizardSchema_copilotSwagger',
          value: stringifySchema(buildCopilotMcpSwagger(options)),
        },
      ];
    case 'openwebui':
      return [
        {
          id: 'openwebui-mcp',
          labelKey: 'mcpWizardSchema_openwebuiMcp',
          value: stringifySchema(buildOpenWebUiMcpConfig(options)),
        },
        {
          id: 'openwebui-openapi',
          labelKey: 'mcpWizardSchema_openwebuiOpenApi',
          value: stringifySchema(buildOpenWebUiOpenApiConfig(options)),
        },
        {
          id: 'openwebui-schema',
          labelKey: 'mcpWizardSchema_openwebuiSchema',
          value: stringifySchema(buildLlmOpenApiDocument(options)),
        },
      ];
    default: {
      const _exhaustive: never = client;
      return _exhaustive;
    }
  }
}

/** Final-step schema export for the client chosen in Configure. */
export function McpClientSchemas({
  client,
  mcpUrl,
  token,
  includeWriteTools,
  onBack,
  onFinish,
  onChangeClient,
}: {
  client: LlmClientId;
  mcpUrl: string;
  token: string;
  includeWriteTools: boolean;
  onBack: () => void;
  onFinish?: () => void;
  onChangeClient?: (client: LlmClientId) => void;
}) {
  const t = useTranslations('admin');
  const { pushToast } = useToast();
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => ({ mcpUrl, token, includeWriteTools }),
    [mcpUrl, token, includeWriteTools],
  );

  const panes = useMemo(
    () => panesForClient(client, options),
    [client, options],
  );

  async function copyText(value: string, id: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setError(null);
      pushToast(t('toastCopied'));
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setError(t('mcpWizardCopyFailed'));
      pushToast(t('mcpWizardCopyFailed'), 'danger');
    }
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="mt-0 mb-1 text-lg font-semibold">
          {t('mcpWizardSchemaTitle', { client: t(`mcpWizardClient_${client}`) })}
        </h2>
        <p className="m-0 text-sm text-ink-muted">{t(`mcpWizardClientBlurb_${client}`)}</p>
      </div>

      {onChangeClient ? (
        <LlmClientPicker value={client} onChange={onChangeClient} />
      ) : null}

      <ul className="m-0 grid list-disc gap-1 pl-5 text-sm text-ink-muted">
        <li>{t(`mcpWizardClientHint1_${client}`)}</li>
        <li>{t(`mcpWizardClientHint2_${client}`)}</li>
        <li>{t(`mcpWizardClientHint3_${client}`)}</li>
      </ul>

      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}

      <div className="kh-ops-setup-grid">
        {panes.map((pane, index) => (
          <article key={pane.id} className="kh-ops-setup-card">
            <div className="kh-ops-card-body">
              <span className="kh-ops-setup-step">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3>{t(pane.labelKey)}</h3>
              <pre className="kh-ops-code mt-3 mb-0 max-h-64 overflow-auto whitespace-pre-wrap">
                {pane.value}
              </pre>
            </div>
            <div className="kh-ops-card-foot">
              <span>{t(`mcpWizardClient_${client}`)}</span>
              <button
                type="button"
                className="kh-ops-text-btn"
                onClick={() => void copyText(pane.value, pane.id)}
              >
                {copied === pane.id ? t('mcpWizardCopied') : t('mcpWizardCopySchema')}
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="kh-ops-action-line px-0">
        <Button type="button" variant="secondary" onClick={onBack}>
          {t('mcpWizardBack')}
        </Button>
        {onFinish ? (
          <Button type="button" onClick={onFinish}>
            {t('mcpWizardFinish')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
