import { getTranslations } from 'next-intl/server';
import { AppHeader } from '../../components/AppHeader';
import { Page, Panel } from '../../components/ui';
import { getSession } from '../../lib/session';

async function fetchApiHealth(apiUrl: string): Promise<{
  status: 'ok' | 'error';
  detail: string;
}> {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      cache: 'no-store',
      next: { revalidate: 0 },
    });
    if (!response.ok) {
      return { status: 'error', detail: `HTTP ${response.status}` };
    }
    return { status: 'ok', detail: 'reachable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { status: 'error', detail: message };
  }
}

export default async function StatusPage() {
  const session = await getSession();
  const t = await getTranslations('statusPage');
  const tCommon = await getTranslations('common');
  const appName = tCommon('appName');
  const appEnv = process.env.APP_ENV ?? 'development';
  const apiUrl = process.env.API_URL ?? 'http://localhost:3101';
  const apiHealth = await fetchApiHealth(apiUrl);

  return (
    <div className="min-h-screen">
      <AppHeader session={session} />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Page>
          <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">
            {t('eyebrow')}
          </p>
          <h1 className="mb-8 text-4xl font-semibold tracking-tight">{appName}</h1>
          <Panel className="grid gap-0 divide-y divide-line overflow-hidden p-0">
            <StatusRow label={t('application')} value={appName} />
            <StatusRow label={t('webStatus')} value={t('ok')} />
            <StatusRow
              label={t('apiHealth')}
              value={
                apiHealth.status === 'ok'
                  ? t('ok')
                  : t('error', { detail: apiHealth.detail })
              }
              tone={apiHealth.status === 'ok' ? 'ok' : 'error'}
            />
            <StatusRow label={t('environment')} value={appEnv} />
            <StatusRow label={t('apiUrl')} value={apiUrl} />
          </Panel>
        </Page>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'error';
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <strong className="text-sm font-medium text-ink">{label}</strong>
      <span
        className={
          tone === 'ok'
            ? 'text-sm font-medium text-accent'
            : tone === 'error'
              ? 'text-sm font-medium text-danger'
              : 'text-sm text-ink-muted'
        }
      >
        {value}
      </span>
    </div>
  );
}
