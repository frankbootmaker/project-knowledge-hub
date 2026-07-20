'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  Select,
  Textarea,
} from './ui';

type Option = { id: string; name: string; slug: string };

export function ConversationImportForm(props: {
  workspaceId: string;
  workspaceSlug: string;
  projects: Option[];
  systems: Option[];
}) {
  const router = useRouter();
  const t = useTranslations('imports');
  const tCommon = useTranslations('common');

  const [title, setTitle] = useState('');
  const [contentFormat, setContentFormat] = useState<'markdown' | 'plain_text'>(
    'markdown',
  );
  const [rawContent, setRawContent] = useState('');
  const [projectId, setProjectId] = useState('');
  const [systemId, setSystemId] = useState('');
  const [generatedByModel, setGeneratedByModel] = useState('');
  const [sourceProvider, setSourceProvider] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/conversation-imports', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: props.workspaceId,
          title,
          contentFormat,
          rawContent,
          projectId: projectId || null,
          systemId: systemId || null,
          generatedByModel: generatedByModel || null,
          sourceProvider: sourceProvider || null,
        }),
      });
      const payload = (await response.json()) as {
        conversationImport?: { id: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedCreate'));
      }
      router.push(
        `/workspaces/${props.workspaceSlug}/imports/${payload.conversationImport?.id ?? ''}`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedCreate'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <form onSubmit={onSubmit} className="grid gap-4">
        <Field label={tCommon('name')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={300}
          />
        </Field>
        <Field label={t('contentFormat')}>
          <Select
            value={contentFormat}
            onChange={(e) =>
              setContentFormat(e.target.value as 'markdown' | 'plain_text')
            }
          >
            <option value="markdown">{t('formatMarkdown')}</option>
            <option value="plain_text">{t('formatPlainText')}</option>
          </Select>
        </Field>
        <Field label={t('rawContent')}>
          <Textarea
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            rows={16}
            required
            className="font-mono text-sm"
          />
        </Field>
        <Field label={t('projectOptional')}>
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{tCommon('none')}</option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('systemOptional')}>
          <Select value={systemId} onChange={(e) => setSystemId(e.target.value)}>
            <option value="">{tCommon('none')}</option>
            {props.systems.map((system) => (
              <option key={system.id} value={system.id}>
                {system.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('generatedByModel')}>
          <Input
            value={generatedByModel}
            onChange={(e) => setGeneratedByModel(e.target.value)}
            placeholder={t('generatedByModelPlaceholder')}
          />
        </Field>
        <Field label={t('sourceProvider')}>
          <Input
            value={sourceProvider}
            onChange={(e) => setSourceProvider(e.target.value)}
            placeholder={t('sourceProviderPlaceholder')}
          />
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Button type="submit" disabled={pending}>
          {pending ? t('creating') : t('createButton')}
        </Button>
      </form>
    </Panel>
  );
}
