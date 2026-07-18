'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewWorkspacePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/workspaces', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const payload = (await response.json()) as {
        workspace?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Failed to create workspace');
      }
      router.push(`/workspaces/${payload.workspace?.slug ?? ''}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>Create workspace</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.85rem' }}>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            style={{ padding: '0.65rem 0.75rem' }}
          />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            style={{ padding: '0.65rem 0.75rem' }}
          />
        </label>
        {error ? <p style={{ color: '#9b1c1c' }}>{error}</p> : null}
        <button
          type="submit"
          disabled={pending}
          style={{
            padding: '0.75rem 1rem',
            border: 'none',
            background: '#1f4b73',
            color: 'white',
            cursor: 'pointer',
          }}
        >
          {pending ? 'Creating…' : 'Create workspace'}
        </button>
      </form>
    </main>
  );
}
