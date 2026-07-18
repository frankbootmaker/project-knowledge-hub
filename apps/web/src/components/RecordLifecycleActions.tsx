'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RecordLifecycleActions({
  recordId,
  lifecycleStatus,
}: {
  recordId: string;
  lifecycleStatus: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: 'verify' | 'mark-current') {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/v1/knowledge-records/${recordId}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Failed to ${action}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
      {lifecycleStatus !== 'verified' && lifecycleStatus !== 'current' ? (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void run('verify')}
          style={{
            padding: '0.45rem 0.75rem',
            border: 'none',
            background: '#1f6b4a',
            color: 'white',
          }}
        >
          {pending === 'verify' ? 'Verifying…' : 'Verify'}
        </button>
      ) : null}
      {lifecycleStatus !== 'current' ? (
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void run('mark-current')}
          style={{
            padding: '0.45rem 0.75rem',
            border: 'none',
            background: '#1f4b73',
            color: 'white',
          }}
        >
          {pending === 'mark-current' ? 'Updating…' : 'Mark current'}
        </button>
      ) : null}
      {error ? <span style={{ color: '#9b1c1c' }}>{error}</span> : null}
    </div>
  );
}
