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
  const appName = 'Project Knowledge Hub';
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
      <p style={{ letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.7 }}>
        Platform status
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
        <StatusRow label="Application" value={appName} />
        <StatusRow label="Web status" value="ok" />
        <StatusRow
          label="API health"
          value={apiHealth.status === 'ok' ? 'ok' : `error (${apiHealth.detail})`}
        />
        <StatusRow label="Environment" value={appEnv} />
        <StatusRow label="API URL" value={apiUrl} />
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
