'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Page,
  PageHeader,
  Panel,
  Select,
  Textarea,
} from '../../../../../../components/ui';

export default function NewProjectPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const workspaceSlug = params.slug;
  const t = useTranslations('projects');
  const tWorkspaces = useTranslations('workspaces');
  const tCommon = useTranslations('common');

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
        throw new Error(tWorkspaces('notFound'));
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
        throw new Error(payload.error?.message ?? t('failedCreate'));
      }
      router.push(`/workspaces/${workspaceSlug}/projects/${payload.project?.slug ?? ''}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Page narrow>
      <PageHeader title={t('createTitle')} />
      <p className="mt-0 mb-6">
        <Link
          href={`/workspaces/${workspaceSlug}`}
          className="text-sm text-ink-muted no-underline hover:text-ink"
        >
          {t('backToWorkspace')}
        </Link>
      </p>
      <Panel>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label={tCommon('name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={tCommon('summary')}>
            <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field label={tCommon('description')}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </Field>
          <Field label={tCommon('status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="idea">idea</option>
              <option value="planned">planned</option>
              <option value="active">active</option>
              <option value="maintenance">maintenance</option>
              <option value="paused">paused</option>
              <option value="completed">completed</option>
              <option value="archived">archived</option>
            </Select>
          </Field>
          <Field label={tCommon('tagsHint')}>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button type="submit" disabled={pending}>
            {pending ? t('creating') : t('createButton')}
          </Button>
        </form>
      </Panel>
    </Page>
  );
}
