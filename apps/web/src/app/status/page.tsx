import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AppHeader } from '../../components/AppHeader';
import { shellContentClassName } from '../../components/shell';
import { Badge, Page, Panel } from '../../components/ui';
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

function environmentTone(appEnv: string): 'success' | 'warn' | 'brand' | 'neutral' {
  const normalized = appEnv.toLowerCase();
  if (normalized === 'production' || normalized === 'prod') return 'warn';
  if (normalized === 'staging' || normalized === 'stage') return 'brand';
  if (normalized === 'test') return 'neutral';
  return 'success';
}

export default async function StatusPage() {
  const session = await getSession();
  const t = await getTranslations('statusPage');
  const tCommon = await getTranslations('common');
  const appName = tCommon('appName');
  const appEnv = process.env.APP_ENV ?? 'development';
  const apiUrl = process.env.API_URL ?? 'http://localhost:3101';
  const apiHealth = await fetchApiHealth(apiUrl);
  const overallOk = apiHealth.status === 'ok';
  const backHref = session?.user.isSystemAdmin
    ? '/admin'
    : session
      ? '/dashboard'
      : '/login';

  return (
    <div className="min-h-screen">
      <AppHeader session={session} />
      <div className={shellContentClassName}>
        <Page>
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="m-0 text-xs font-semibold tracking-[0.14em] text-ink-muted uppercase">
              {t('eyebrow')}
            </p>
            <Link
              href={backHref}
              className="shrink-0 text-sm font-medium text-brand no-underline hover:text-brand-hover"
            >
              {session?.user.isSystemAdmin ? t('backToAdmin') : tCommon('back')}
            </Link>
          </div>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-4xl font-semibold tracking-tight">{appName}</h1>
            <Badge tone={overallOk ? 'success' : 'danger'}>
              {overallOk ? t('overallHealthy') : t('overallDegraded')}
            </Badge>
          </div>
          <Panel className="grid gap-0 divide-y divide-line overflow-hidden p-0">
            <StatusRow label={t('application')} value={appName} tone="brand" />
            <StatusRow label={t('webStatus')} value={t('ok')} tone="ok" />
            <StatusRow
              label={t('apiHealth')}
              value={
                apiHealth.status === 'ok'
                  ? t('ok')
                  : t('error', { detail: apiHealth.detail })
              }
              tone={apiHealth.status === 'ok' ? 'ok' : 'error'}
            />
            <StatusRow
              label={t('environment')}
              value={appEnv}
              tone={environmentTone(appEnv)}
            />
            <StatusRow label={t('apiUrl')} value={apiUrl} tone="neutral" />
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
  tone?: 'neutral' | 'ok' | 'error' | 'brand' | 'success' | 'warn';
}) {
  const badgeTone =
    tone === 'ok' || tone === 'success'
      ? 'success'
      : tone === 'error'
        ? 'danger'
        : tone === 'brand'
          ? 'brand'
          : tone === 'warn'
            ? 'warn'
            : 'neutral';
  const useBadge = tone !== 'neutral' || value.length <= 24;

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5">
      <strong className="text-sm font-medium text-ink">{label}</strong>
      {useBadge ? (
        <Badge tone={badgeTone} className="max-w-[min(100%,20rem)] truncate">
          {value}
        </Badge>
      ) : (
        <span className="max-w-[min(100%,20rem)] truncate text-sm text-ink-muted" title={value}>
          {value}
        </span>
      )}
    </div>
  );
}
