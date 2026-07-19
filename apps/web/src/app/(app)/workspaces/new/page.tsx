'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WorkspaceColorPicker } from '../../../../components/WorkspaceColorPicker';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Page,
  PageHeader,
  Panel,
  Textarea,
} from '../../../../components/ui';
import { WORKSPACE_DESCRIPTION_MAX_LENGTH } from '@project-knowledge-hub/domain';
import type { WorkspaceColor } from '../../../../lib/workspace-colors';

export default function NewWorkspacePage() {
  const router = useRouter();
  const t = useTranslations('workspaces');
  const tCommon = useTranslations('common');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<WorkspaceColor | null>(null);
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
        body: JSON.stringify({
          name,
          description: description || undefined,
          color,
        }),
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
              maxLength={WORKSPACE_DESCRIPTION_MAX_LENGTH}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder={t('descriptionPlaceholder')}
            />
            <p className="m-0 text-xs text-ink-muted">
              {t('descriptionLimit', {
                count: description.length,
                max: WORKSPACE_DESCRIPTION_MAX_LENGTH,
              })}
            </p>
          </Field>
          <Field label={t('colorLabel')}>
            <p className="mb-2 mt-0 text-sm text-ink-muted">{t('colorHint')}</p>
            <WorkspaceColorPicker
              value={color}
              seed={name || 'workspace'}
              onChange={setColor}
              allowAuto
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
