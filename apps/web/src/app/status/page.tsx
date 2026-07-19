import { getTranslations } from 'next-intl/server';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

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
  const t = await getTranslations('statusPage');
  const tCommon = await getTranslations('common');
  const appName = tCommon('appName');
  const appEnv = process.env.APP_ENV ?? 'development';
  const apiUrl = process.env.API_URL ?? 'http://localhost:3101';
  const apiHealth = await fetchApiHealth(apiUrl);

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '4rem 1.5rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <LanguageSwitcher />
      </div>
      <p style={{ letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 }}>
        {t('eyebrow')}
      </p>
      <h1 style={{ fontSize: '2.5rem', margin: '0.4rem 0 1.5rem' }}>{appName}</h1>
      <section
        style={{
          display: 'grid',
          gap: '0.85rem',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(21,32,43,0.08)',
          padding: '1.25rem 1.5rem',
        }}
      >
        <StatusRow label={t('application')} value={appName} />
        <StatusRow label={t('webStatus')} value={t('ok')} />
        <StatusRow
          label={t('apiHealth')}
          value={
            apiHealth.status === 'ok'
              ? t('ok')
              : t('error', { detail: apiHealth.detail })
          }
        />
        <StatusRow label={t('environment')} value={appEnv} />
        <StatusRow label={t('apiUrl')} value={apiUrl} />
      </section>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '1rem',
        borderBottom: '1px solid rgba(21,32,43,0.08)',
        paddingBottom: '0.65rem',
      }}
    >
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
