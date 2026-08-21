'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { OpsCountStrip } from './ops/OpsCountStrip';
import {
  Button,
  ErrorText,
  FilePicker,
  Select,
  useToast,
} from './ui';

export type WorkspaceMediaItem = {
  id: string;
  url: string;
  markdownSnippet: string;
  altText: string | null;
  originalFilename: string | null;
  contentType: string;
  byteSize: number;
  knowledgeRecordId: string | null;
  createdAt: string;
};

export type MediaRecordOption = {
  id: string;
  title: string;
  slug: string;
};

type Filter = 'all' | 'linked' | 'unlinked';
type ViewMode = 'grid' | 'list';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(contentType: string): string {
  const subtype = contentType.split('/')[1];
  return (subtype ?? contentType).toUpperCase();
}

export function WorkspaceMediaLibrary(props: {
  workspaceId: string;
  workspaceSlug: string;
  canMutate: boolean;
  initialMedia: WorkspaceMediaItem[];
  records: MediaRecordOption[];
}) {
  const t = useTranslations('media');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [items, setItems] = useState(props.initialMedia);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<ViewMode>('grid');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);

  const recordById = useMemo(
    () => new Map(props.records.map((row) => [row.id, row])),
    [props.records],
  );

  const linkedCount = items.filter((item) => item.knowledgeRecordId).length;
  const visible = items.filter((item) => {
    if (filter === 'linked') return Boolean(item.knowledgeRecordId);
    if (filter === 'unlinked') return !item.knowledgeRecordId;
    return true;
  });

  async function refresh() {
    const response = await fetch(
      `/api/v1/workspaces/${props.workspaceId}/media?limit=100`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!response.ok) return;
    const body = (await response.json()) as { media?: WorkspaceMediaItem[] };
    setItems(body.media ?? []);
    router.refresh();
  }

  async function uploadFile(file: File | null) {
    if (!file || !props.canMutate) return;
    setPending(true);
    setError(null);
    setUploadName(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('alt', file.name.replace(/\.[^.]+$/, '') || 'image');
      const response = await fetch(
        `/api/v1/workspaces/${props.workspaceId}/media`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { Origin: window.location.origin },
          body: form,
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? tRecords('mediaUploadFailed'));
      }
      pushToast(t('uploaded'));
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : tRecords('mediaUploadFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
      setUploadName(null);
    }
  }

  async function copyText(value: string, okMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      pushToast(okMessage);
    } catch {
      pushToast(t('copyFailed'), 'danger');
    }
  }

  async function linkRecord(mediaId: string, knowledgeRecordId: string) {
    if (!props.canMutate) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/media/${mediaId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({
          knowledgeRecordId: knowledgeRecordId || null,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? t('linkFailed'));
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('linkFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function deleteMedia(mediaId: string) {
    if (!props.canMutate) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/media/${mediaId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { Origin: window.location.origin },
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? tRecords('mediaDeleteFailed'));
      }
      setConfirmId(null);
      pushToast(t('deleted'));
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : tRecords('mediaDeleteFailed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  function actions(item: WorkspaceMediaItem) {
    const absUrl =
      typeof window === 'undefined'
        ? item.url
        : `${window.location.origin}${item.url}`;
    const record = item.knowledgeRecordId
      ? recordById.get(item.knowledgeRecordId)
      : null;
    return (
      <>
        <button
          type="button"
          className="kh-ops-text-btn"
          onClick={() => void copyText(item.markdownSnippet, t('copiedMarkdown'))}
        >
          {tRecords('mediaInsertExisting')}
        </button>
        <button
          type="button"
          className="kh-ops-text-btn"
          onClick={() => void copyText(absUrl, t('copiedUrl'))}
        >
          {t('copyUrl')}
        </button>
        {record ? (
          <Link
            href={`/workspaces/${props.workspaceSlug}/records/${record.slug}`}
            className="kh-ops-text-btn no-underline"
          >
            {record.title}
          </Link>
        ) : null}
        {props.canMutate ? (
          confirmId === item.id ? (
            <div className="kh-ops-confirm max-w-none">
              <p className="m-0 text-sm text-danger">{t('confirmDelete')}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={() => void deleteMedia(item.id)}
                >
                  {tRecords('mediaDelete')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setConfirmId(null)}
                >
                  {tCommon('cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="kh-ops-text-btn"
              disabled={pending}
              onClick={() => setConfirmId(item.id)}
            >
              {tRecords('mediaDelete')}
            </button>
          )
        ) : null}
      </>
    );
  }

  function linkSelect(item: WorkspaceMediaItem) {
    if (!props.canMutate) return null;
    return (
      <Select
        value={item.knowledgeRecordId ?? ''}
        disabled={pending}
        aria-label={t('linkedRecord')}
        onChange={(event) => void linkRecord(item.id, event.target.value)}
      >
        <option value="">{t('unlinked')}</option>
        {props.records.map((row) => (
          <option key={row.id} value={row.id}>
            {row.title}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <div className="grid gap-4">
      <OpsCountStrip
        items={[
          { label: t('countTotal'), value: items.length },
          { label: t('countLinked'), value: linkedCount },
          { label: t('countUnlinked'), value: items.length - linkedCount },
        ]}
      />

      <div className="kh-ops-toolbar">
        {props.canMutate ? (
          <FilePicker
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={pending}
            fileName={uploadName}
            onFileChange={(file) => void uploadFile(file)}
            aria-label={t('upload')}
          />
        ) : (
          <span className="text-sm text-ink-muted">{t('readOnly')}</span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'linked', 'unlinked'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="kh-ops-type-chip"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`filter_${value}`)}
            </button>
          ))}
          <button
            type="button"
            className="kh-ops-type-chip"
            aria-pressed={view === 'grid'}
            onClick={() => setView('grid')}
          >
            {t('viewGrid')}
          </button>
          <button
            type="button"
            className="kh-ops-type-chip"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            {t('viewList')}
          </button>
        </div>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {visible.length === 0 ? (
        <p className="kh-ops-empty">{t('empty')}</p>
      ) : view === 'grid' ? (
        <div className="kh-ops-media-grid">
          {visible.map((item) => (
            <article key={item.id} className="kh-ops-media-card">
              <div className="kh-ops-media-preview">
                <img
                  src={item.url}
                  alt={item.altText ?? item.originalFilename ?? ''}
                />
                <span className="kh-ops-type-chip">{typeLabel(item.contentType)}</span>
              </div>
              <div className="kh-ops-media-info">
                <strong>
                  {item.originalFilename ?? item.altText ?? item.id}
                </strong>
                <small>
                  {formatBytes(item.byteSize)} ·{' '}
                  {new Date(item.createdAt).toLocaleDateString()}
                </small>
              </div>
              {props.canMutate ? (
                <div className="px-2.5 pb-2">{linkSelect(item)}</div>
              ) : null}
              <div className="kh-ops-card-foot flex-wrap">{actions(item)}</div>
            </article>
          ))}
        </div>
      ) : (
        <section className="kh-ops-panel overflow-hidden">
          <div className="kh-ops-table-wrap">
            <table className="kh-ops-data-table">
              <thead>
                <tr>
                  <th>{t('colName')}</th>
                  <th>{t('colType')}</th>
                  <th>{t('colSize')}</th>
                  <th>{t('linkedRecord')}</th>
                  <th>{tCommon('updated')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td className="kh-ops-primary-cell">
                      {item.originalFilename ?? item.altText ?? item.id}
                    </td>
                    <td>
                      <span className="kh-ops-type-chip">
                        {typeLabel(item.contentType)}
                      </span>
                    </td>
                    <td>{formatBytes(item.byteSize)}</td>
                    <td>{linkSelect(item)}</td>
                    <td>{new Date(item.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">{actions(item)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
