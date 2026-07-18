'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function NewProjectPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const workspaceSlug = params.slug;

  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const workspacesResponse = await fetch('/api/v1/workspaces', { credentials: 'include' });
      const workspacesPayload = (await workspacesResponse.json()) as {
        workspaces: Array<{ id: string; slug: string }>;
      };
      const workspace = workspacesPayload.workspaces.find((item) => item.slug === workspaceSlug);
      if (!workspace) {
        throw new Error('Workspace not found');
      }

      const response = await fetch('/api/v1/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: workspace.id,
          name,
          summary: summary || undefined,
          description: description || undefined,
          status,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as {
        project?: { slug: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? 'Failed to create project');
      }
      router.push(`/workspaces/${workspaceSlug}/projects/${payload.project?.slug ?? ''}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={{ maxWidth: 560, margin: '0 auto' }}>
      <h1>Create project</h1>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.85rem' }}>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required style={{ padding: '0.65rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Summary</span>
          <input value={summary} onChange={(e) => setSummary(e.target.value)} style={{ padding: '0.65rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ padding: '0.65rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '0.65rem' }}>
            <option value="idea">idea</option>
            <option value="planned">planned</option>
            <option value="active">active</option>
            <option value="maintenance">maintenance</option>
            <option value="paused">paused</option>
            <option value="completed">completed</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Tags (comma-separated)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ padding: '0.65rem' }} />
        </label>
        {error ? <p style={{ color: '#9b1c1c' }}>{error}</p> : null}
        <button type="submit" disabled={pending} style={{ padding: '0.75rem', border: 'none', background: '#1f4b73', color: 'white' }}>
          {pending ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </main>
  );
}
