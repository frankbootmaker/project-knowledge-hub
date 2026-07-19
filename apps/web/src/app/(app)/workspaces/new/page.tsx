'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, ErrorText, Field, Input, Page, PageHeader, Panel, Textarea } from '../../../../components/ui';

export default function NewWorkspacePage() {
  const router = useRouter();
  const t = useTranslations('workspaces');
  const tCommon = useTranslations('common');
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
        throw new Error(payload.error?.message ?? t('failedCreate'));
      }
      router.push(`/workspaces/${payload.workspace?.slug ?? ''}`);
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
      <Panel>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label={tCommon('name')}>
            <Input value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field label={tCommon('description')}>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
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
