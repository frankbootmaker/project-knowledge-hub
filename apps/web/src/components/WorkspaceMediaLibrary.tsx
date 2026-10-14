'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { collectEnumOptions } from '../lib/data-table';
import {
  mediaMatchesFilter,
  type MediaFilterQuery,
} from '../lib/media-library-filter';
import { useSyncEnumFilters, useTableState } from '../lib/use-table-state';
import { OpsCountStrip } from './ops/OpsCountStrip';
import {
  Button,
  ErrorText,
  FilePicker,
  Input,
  Modal,
  TableFilterControl,
  useToast,
  type TableFilterField,
} from './ui';
import { LocalDateTime } from './LocalDateTime';

const ENTITY_LABEL_KEYS = {
  epic: 'entity_epic',
  user_story: 'entity_user_story',
  milestone: 'entity_milestone',
  task: 'entity_task',
  sprint: 'entity_sprint',
  raid: 'entity_raid',
  change: 'entity_change',
} as const;

type EntityLabelKey = keyof typeof ENTITY_LABEL_KEYS;

export type MediaUsedByItem = {
  entityType: string;
  entityId: string;
  humanKey: string | null;
  title: string;
};

export type WorkspaceMediaItem = {
  id: string;
  url: string;
  markdownSnippet: string;
  altText: string | null;
  originalFilename: string | null;
  contentType: string;
  byteSize: number;
  knowledgeRecordId: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  usedBy: MediaUsedByItem[];
};

type ViewMode = 'grid' | 'list';

const KNOWN_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(contentType: string): string {
  const subtype = contentType.split('/')[1];
  return (subtype ?? contentType).toUpperCase();
}

function isEntityLabelKey(value: string): value is EntityLabelKey {
  return Object.prototype.hasOwnProperty.call(ENTITY_LABEL_KEYS, value);
}

function mediaName(item: WorkspaceMediaItem): string {
  return item.originalFilename ?? item.altText ?? item.id;
}

function isLinked(item: WorkspaceMediaItem): boolean {
  return item.usedBy.length > 0;
}

function MediaUrl({ url }: { url: string }) {
  const [href, setHref] = useState(url);

  useEffect(() => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      setHref(url);
      return;
    }
    setHref(`${window.location.origin}${url}`);
  }, [url]);

  return (
    <a href={href} className="break-all text-brand no-underline hover:text-brand-hover">
      {href}
    </a>
  );
}

export function WorkspaceMediaLibrary(props: {
  workspaceId: string;
  canMutate: boolean;
  initialMedia: WorkspaceMediaItem[];
}) {
  const t = useTranslations('media');
  const tRecords = useTranslations('records');
  const tCommon = useTranslations('common');
  const tTable = useTranslations('table');
  const locale = useLocale();
  const router = useRouter();
  const { pushToast } = useToast();
  const table = useTableState({
    namespace: 'ml',
    defaultSortKey: null,
  });
  const [items, setItems] = useState(props.initialMedia);
  const [view, setView] = useState<ViewMode>('grid');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);

  const linkedCount = items.filter((item) => isLinked(item)).length;
  const createdFrom = table.extras.from ?? '';
  const createdTo = table.extras.to ?? '';
  const typeOptions = useMemo(() => {
    const values = new Set<string>(KNOWN_MEDIA_TYPES);
    for (const item of items) values.add(item.contentType);
    return [...values].map((value) => ({
      value,
      label: `${typeLabel(value)} · ${value}`,
    }));
  }, [items]);
  const linkOptions = useMemo(
    () => [
      { value: 'linked', label: t('filter_linked') },
      { value: 'unlinked', label: t('filter_unlinked') },
    ],
    [t],
  );
  const itemTypeOptions = useMemo(
    () =>
      (Object.keys(ENTITY_LABEL_KEYS) as EntityLabelKey[]).map((value) => ({
        value,
        label: t(ENTITY_LABEL_KEYS[value]),
      })),
    [t],
  );
  const uploaderOptions = useMemo(
    () =>
      collectEnumOptions(
        items,
        (item) => item.createdByName ?? '',
        (value) => value,
        locale,
      ),
    [items, locale],
  );
  const filterFields = useMemo<TableFilterField[]>(
    () => [
      { id: 'type', header: t('colType'), type: 'enum', options: typeOptions },
      {
        id: 'link',
        header: t('filterLinkStatus'),
        type: 'enum',
        options: linkOptions,
      },
      {
        id: 'itemType',
        header: t('filterItemType'),
        type: 'enum',
        options: itemTypeOptions,
      },
      {
        id: 'uploader',
        header: t('detailUploader'),
        type: 'enum',
        options: uploaderOptions,
      },
    ],
    [itemTypeOptions, linkOptions, t, typeOptions, uploaderOptions],
  );
  const filterColumns = useMemo(
    () =>
      filterFields.map((field) => ({
        id: field.id,
        filter: {
          type: 'enum' as const,
          getValue: () => '',
          options: field.options,
        },
      })),
    [filterFields],
  );
  useSyncEnumFilters(table.filters, filterColumns, table.setEnumFilter);
  const filterQuery = useMemo<MediaFilterQuery>(
    () => ({
      query: table.query,
      contentTypes: table.filters.type ?? [],
      linkStatus: table.filters.link ?? [],
      itemTypes: table.filters.itemType ?? [],
      uploaders: table.filters.uploader ?? [],
      createdFrom,
      createdTo,
    }),
    [
      createdFrom,
      createdTo,
      table.filters.itemType,
      table.filters.link,
      table.filters.type,
      table.filters.uploader,
      table.query,
    ],
  );
  const filtersActive =
    table.filtersActive || createdFrom !== '' || createdTo !== '';
  const visible = useMemo(
    () => items.filter((item) => mediaMatchesFilter(item, filterQuery)),
    [filterQuery, items],
  );
  const details = items.find((item) => item.id === detailsId) ?? null;

  function clearFilters() {
    table.clearFilters();
    table.setExtra('from', '');
    table.setExtra('to', '');
  }

  function entityLabel(entityType: string): string {
    if (!isEntityLabelKey(entityType)) return entityType;
    return t(ENTITY_LABEL_KEYS[entityType]);
  }

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
      if (detailsId === mediaId) setDetailsId(null);
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

  function absoluteUrl(url: string): string {
    if (typeof window === 'undefined') return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${window.location.origin}${url}`;
  }

  function linkedSummary(item: WorkspaceMediaItem): string {
    if (!isLinked(item)) return t('unlinked');
    return item.usedBy
      .map((row) => row.humanKey ?? row.title)
      .join(', ');
  }

  function actions(item: WorkspaceMediaItem) {
    return (
      <div className="kh-ops-media-card-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copyText(item.markdownSnippet, t('copiedMarkdown'))}
        >
          {tRecords('mediaInsertExisting')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void copyText(absoluteUrl(item.url), t('copiedUrl'))}
        >
          {t('copyUrl')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setDetailsId(item.id)}
        >
          {tRecords('showMoreDetails')}
        </Button>
        {props.canMutate ? (
          confirmId === item.id ? (
            <div className="kh-ops-confirm max-w-none">
              <p className="m-0 text-danger">{t('confirmDelete')}</p>
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
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              onClick={() => setConfirmId(item.id)}
            >
              {tRecords('mediaDelete')}
            </Button>
          )
        ) : null}
      </div>
    );
  }

  return (
    <div className="kh-ops-media-library grid gap-4">
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
          <span className="text-ink-muted">{t('readOnly')}</span>
        )}
        <label className="flex min-w-[12rem] flex-1 items-center gap-2">
          <span className="sr-only">{t('searchPlaceholder')}</span>
          <Input
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-10 min-h-10 py-1.5 text-xs"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
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
          <TableFilterControl
            fields={filterFields}
            enumFilters={table.filters}
            textFilters={table.textFilters}
            onEnumFilter={table.setEnumFilter}
            onTextFilter={table.setTextFilter}
            onClearFilters={clearFilters}
            filtersActive={filtersActive}
            insertAfter={{
              id: 'uploader',
              content: (
                <fieldset className="kh-ops-table-filter-group">
                  <legend>{t('filterCreated')}</legend>
                  <label className="grid gap-1">
                    <span>{t('filterFrom')}</span>
                    <Input
                      type="date"
                      value={createdFrom}
                      aria-label={t('filterFrom')}
                      className="h-10 min-h-10 py-1.5 text-xs"
                      onChange={(event) => table.setExtra('from', event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span>{t('filterTo')}</span>
                    <Input
                      type="date"
                      value={createdTo}
                      aria-label={t('filterTo')}
                      className="h-10 min-h-10 py-1.5 text-xs"
                      onChange={(event) => table.setExtra('to', event.target.value)}
                    />
                  </label>
                </fieldset>
              ),
            }}
          />
        </div>
      </div>

      {error ? <ErrorText>{error}</ErrorText> : null}

      {visible.length === 0 ? (
        <div className="grid justify-items-start gap-3">
          <p className="kh-ops-empty">
            {items.length === 0 ? t('empty') : t('emptyFiltered')}
          </p>
          {filtersActive ? (
            <Button type="button" variant="secondary" onClick={clearFilters}>
              {tTable('clearFilters')}
            </Button>
          ) : null}
        </div>
      ) : view === 'grid' ? (
        <div className="kh-ops-media-grid">
          {visible.map((item) => (
            <article key={item.id} className="kh-ops-media-card">
              <div className="kh-ops-media-preview">
                <img src={item.url} alt={item.altText ?? item.originalFilename ?? ''} />
                <span className="kh-ops-type-chip">{typeLabel(item.contentType)}</span>
              </div>
              <div className="kh-ops-media-info">
                <strong>{mediaName(item)}</strong>
                <small>
                  {formatBytes(item.byteSize)} ·{' '}
                  <LocalDateTime value={item.createdAt} dateOnly />
                </small>
              </div>
              <div className="kh-ops-card-foot">{actions(item)}</div>
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
                  <th>{t('linkedItems')}</th>
                  <th>{tCommon('updated')}</th>
                  <th>{t('colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td className="kh-ops-primary-cell">{mediaName(item)}</td>
                    <td>
                      <span className="kh-ops-type-chip">
                        {typeLabel(item.contentType)}
                      </span>
                    </td>
                    <td>{formatBytes(item.byteSize)}</td>
                    <td className="kh-ops-media-linked">{linkedSummary(item)}</td>
                    <td>
                      <LocalDateTime value={item.createdAt} dateOnly />
                    </td>
                    <td>{actions(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        open={Boolean(details)}
        onClose={() => setDetailsId(null)}
        title={tRecords('showMoreDetails')}
        panelClassName="kh-ops-media-library"
        footer={
          <Button type="button" variant="secondary" onClick={() => setDetailsId(null)}>
            {tCommon('close')}
          </Button>
        }
      >
        {details ? (
          <div className="grid gap-6">
            <div>
              <h2 className="kh-ops-panel-title mt-0 mb-2">{t('properties')}</h2>
              <dl className="kh-ops-keyvals">
                <div className="contents">
                  <dt>{tCommon('name')}</dt>
                  <dd>{mediaName(details)}</dd>
                </div>
                <div className="contents">
                  <dt>{t('colType')}</dt>
                  <dd>
                    {typeLabel(details.contentType)} · {details.contentType}
                  </dd>
                </div>
                <div className="contents">
                  <dt>{t('colSize')}</dt>
                  <dd>{formatBytes(details.byteSize)}</dd>
                </div>
                <div className="contents">
                  <dt>{t('detailUploader')}</dt>
                  <dd>{details.createdByName ?? tCommon('emDash')}</dd>
                </div>
                <div className="contents">
                  <dt>{t('detailCreated')}</dt>
                  <dd>
                    <LocalDateTime value={details.createdAt} />
                  </dd>
                </div>
                <div className="contents">
                  <dt>{t('detailUrl')}</dt>
                  <dd>
                    <MediaUrl url={details.url} />
                  </dd>
                </div>
              </dl>
            </div>
            <div className="grid gap-2">
              <h2 className="kh-ops-panel-title m-0">{t('linkedItems')}</h2>
              {details.usedBy.length === 0 ? (
                <p className="kh-ops-empty px-0 py-0">{t('linkedItemsEmpty')}</p>
              ) : (
                <div className="kh-ops-media-link-list">
                  <div className="kh-ops-media-link-head" role="row">
                    <span>{t('colType')}</span>
                    <span>{t('colKey')}</span>
                    <span>{tCommon('title')}</span>
                  </div>
                  {details.usedBy.map((row) => (
                    <div
                      key={`${row.entityType}:${row.entityId}`}
                      role="row"
                    >
                      <span>{entityLabel(row.entityType)}</span>
                      <span>{row.humanKey ?? tCommon('emDash')}</span>
                      <span>{row.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
