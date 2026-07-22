import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { LinkButton, Page, Panel } from '../../components/ui';

/** Server-side fetch target (may be internal Compose DNS like http://api:3101). */
const internalApiUrl =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3101';

/** Public origin shown to humans and external AI clients. */
const publicOrigin = (
  process.env.WEB_URL ??
  process.env.NEXT_PUBLIC_WEB_URL ??
  'http://localhost:3100'
).replace(/\/$/, '');

export default async function AiDiscoverPage() {
  const t = await getTranslations('aiDiscover');
  const tCommon = await getTranslations('common');

  type DiscoverDoc = {
    mcpUrl?: string;
    openapiUrl?: string;
    publicApiBase?: string;
    pairingCodeTtlSeconds?: number;
    defaultScopes?: string[];
    endpoints?: Record<string, string>;
    steps?: string[];
    createRequestBody?: Record<string, string>;
  };

  let discover: DiscoverDoc | null = null;

  try {
    const response = await fetch(`${internalApiUrl}/api/v1/ai-discover`, {
      cache: 'no-store',
    });
    if (response.ok) {
      discover = (await response.json()) as DiscoverDoc;
    }
  } catch {
    discover = null;
  }

  const apiBase = (discover?.publicApiBase ?? publicOrigin).replace(/\/$/, '');
  const mcpUrl = discover?.mcpUrl ?? `${apiBase}/mcp`;
  const openapiUrl =
    discover?.openapiUrl ?? `${apiBase}/api/v1/llm/openapi.json`;
  const apiDiscoverUrl =
    discover?.endpoints?.discover ?? `${apiBase}/api/v1/ai-discover`;
  const createRequestUrl =
    discover?.endpoints?.createRequest ?? `${apiBase}/api/v1/ai-discover/requests`;
  const claimOrPollUrl =
    discover?.endpoints?.claimOrPoll ??
    `${apiBase}/api/v1/ai-discover/requests/<requestId>?claimSecret=<secret>`;

  return (
    <Page narrow className="px-4 py-16">
      <div className="mb-4 flex justify-end">
        <LanguageSwitcher />
      </div>
      <div className="mb-6">
        <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">
          {tCommon('brandName')}
        </p>
        <h1 className="m-0 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-ink-muted">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4">
        <Panel className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('forAgents')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('forAgentsBlurb')}</p>
          <ul className="m-0 grid list-disc gap-1 pl-5 text-sm">
            <li>
              <span className="text-ink-muted">{t('machineReadable')}: </span>
              <code className="text-xs">{apiDiscoverUrl}</code>
            </li>
            <li>
              <span className="text-ink-muted">MCP: </span>
              <code className="text-xs">{mcpUrl}</code>
            </li>
            <li>
              <span className="text-ink-muted">OpenAPI: </span>
              <code className="text-xs">{openapiUrl}</code>
            </li>
          </ul>
          {discover?.defaultScopes ? (
            <p className="m-0 text-sm">
              <span className="text-ink-muted">{t('defaultScopes')}: </span>
              <code className="text-xs">{discover.defaultScopes.join(', ')}</code>
            </p>
          ) : null}
        </Panel>

        <Panel className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('stepsTitle')}</h2>
          <ol className="m-0 grid list-decimal gap-2 pl-5 text-sm">
            <li>{t('step1')}</li>
            <li>{t('step2')}</li>
            <li>{t('step3')}</li>
            <li>{t('step4')}</li>
            <li>{t('step5')}</li>
            <li>{t('step6')}</li>
          </ol>
        </Panel>

        <Panel className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('requestTitle')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('requestBlurb')}</p>
          <pre className="m-0 overflow-x-auto rounded-md bg-panel-solid p-3 text-xs">
            {`POST ${createRequestUrl}
Content-Type: application/json

{
  "pairingCode": "<code from user>",
  "name": "ChatGPT Knowledge Hub",
  "agentLabel": "chatgpt",
  "requestWrite": false
}`}
          </pre>
          <p className="m-0 text-sm text-ink-muted">{t('pollBlurb')}</p>
          <pre className="m-0 overflow-x-auto rounded-md bg-panel-solid p-3 text-xs">
            {`GET ${claimOrPollUrl}`}
          </pre>
          <p className="m-0 text-xs text-ink-muted">
            agentLabel examples: cursor | chatgpt | claude | antigravity | gemini | openwebui
          </p>
        </Panel>

        <Panel className="grid gap-3">
          <h2 className="m-0 text-base font-semibold">{t('forHumans')}</h2>
          <p className="m-0 text-sm text-ink-muted">{t('forHumansBlurb')}</p>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/register" variant="secondary">
              {t('register')}
            </LinkButton>
            <LinkButton href="/login" variant="secondary">
              {t('signIn')}
            </LinkButton>
            <LinkButton href="/account/ai-connections">
              {t('connectAi')}
            </LinkButton>
          </div>
          <p className="m-0 text-xs text-ink-muted">
            {t('siteHint', { url: publicOrigin })}
          </p>
        </Panel>

        <p className="m-0 text-center text-sm text-ink-muted">
          <Link href="/login" className="underline-offset-2 hover:underline">
            {t('backToLogin')}
          </Link>
        </p>
      </div>
    </Page>
  );
}
