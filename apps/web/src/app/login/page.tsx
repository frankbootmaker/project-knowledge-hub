'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('login');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('admin@localhost.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? ((await response.json()) as { error?: { message?: string } })
        : null;

      if (!response.ok) {
        throw new Error(payload?.error?.message ?? `${t('failed')} (${response.status})`);
      }

      router.replace('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '0 1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <LanguageSwitcher />
      </div>
      <h1 style={{ marginBottom: '0.35rem' }}>{tCommon('appName')}</h1>
      <p style={{ opacity: 0.75, marginTop: 0 }}>{t('subtitle')}</p>
      <form
        onSubmit={onSubmit}
        style={{
          display: 'grid',
          gap: '0.85rem',
          marginTop: '1.5rem',
          background: 'rgba(255,255,255,0.75)',
          padding: '1.25rem',
          border: '1px solid rgba(21,32,43,0.08)',
        }}
      >
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>{t('email')}</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            style={{ padding: '0.65rem 0.75rem', fontSize: '1rem' }}
          />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>{t('password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            style={{ padding: '0.65rem 0.75rem', fontSize: '1rem' }}
          />
        </label>
        {error ? <p style={{ color: '#9b1c1c', margin: 0 }}>{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: '0.75rem 1rem',
            border: 'none',
            background: '#1f4b73',
            color: 'white',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          {pending ? t('signingIn') : t('signIn')}
        </button>
      </form>
    </main>
  );
}
