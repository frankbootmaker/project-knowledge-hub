'use client';

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { MediaLightbox, type MediaLightboxItem } from './MediaLightbox';
import { Button, Field, Input, Modal, Select } from './ui';

const PAGE_SIZES = [5, 10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

export type ItemMediaEntityType =
  | 'epic'
  | 'user_story'
  | 'milestone'
  | 'task'
  | 'sprint'
  | 'raid'
  | 'change';

export type ItemMediaDraft =
  | {
      kind: 'media';
      mediaId: string;
      title?: string | null;
      description?: string | null;
    }
  | {
      kind: 'url';
      url: string;
      title: string;
      description?: string | null;
    };

type MediaLink = {
  id: string;
  kind: 'media' | 'url';
  title: string | null;
  description: string | null;
  url: string | null;
  filename: string | null;
  byteSize: number | null;
  mediaId: string | null;
  deleted: boolean;
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
};
const MEDIA_TYPE_ORDER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

type LibraryItem = {
  id: string;
  originalFilename: string | null;
  byteSize: number;
  contentType: string;
  url: string;
};

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

function draftsFromLinks(links: MediaLink[]): ItemMediaDraft[] {
  const drafts: ItemMediaDraft[] = [];
  for (const link of links) {
    if (link.kind === 'url' && link.url && link.title) {
      drafts.push({
        kind: 'url',
        url: link.url,
        title: link.title,
        description: link.description,
      });
    } else if (link.kind === 'media' && link.mediaId) {
      drafts.push({
        kind: 'media',
        mediaId: link.mediaId,
        title: link.title,
        description: link.description,
      });
    }
  }
  return drafts;
}

export async function saveItemMediaLinks(input: {
  projectId: string;
  entityType: ItemMediaEntityType;
  entityId: string;
  links: ItemMediaDraft[];
}): Promise<MediaLink[]> {
  const response = await fetch(
    `/api/v1/projects/${input.projectId}/item-media-links`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({
        entityType: input.entityType,
        entityId: input.entityId,
        links: input.links,
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    mediaLinks?: MediaLink[];
    error?: { message?: string };
  };
  if (!response.ok || !payload.mediaLinks) {
    throw new Error(payload.error?.message || 'Failed to update media');
  }
  return payload.mediaLinks;
}

export function DeliveryMediaEditor({
  projectId,
  workspaceId,
  entityType,
  entityId,
  canEdit,
  immediate = false,
  disabled = false,
  onDraftsChange,
}: {
  projectId: string;
  workspaceId: string | null;
  entityType: ItemMediaEntityType;
  entityId: string | null;
  canEdit: boolean;
  immediate?: boolean;
  disabled?: boolean;
  onDraftsChange?: (drafts: ItemMediaDraft[] | null) => void;
}) {
  const t = useTranslations('delivery');
  const tRaid = useTranslations('raid');
  const tCommon = useTranslations('common');
  const [links, setLinks] = useState<MediaLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(5);
  const [picked, setPicked] = useState<string[]>([]);
  const [urlTitle, setUrlTitle] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [urlDescription, setUrlDescription] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const response = await fetch(
      `/api/v1/projects/${projectId}/item-media-links?entityType=${entityType}&entityId=${entityId}`,
      { credentials: 'include' },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      mediaLinks?: MediaLink[];
    };
    if (!response.ok || !payload.mediaLinks) return;
    setLinks(payload.mediaLinks);
    onDraftsChange?.(draftsFromLinks(payload.mediaLinks));
  }

  useEffect(() => {
    if (!entityId) {
      setLinks([]);
      onDraftsChange?.([]);
      return;
    }
    onDraftsChange?.(null);
    void load();
    // Reload when the item changes. onDraftsChange is stable enough for parents.
  }, [projectId, entityType, entityId]);

  async function commit(next: ItemMediaDraft[]) {
    onDraftsChange?.(next);
    if (!immediate || !entityId) return;
    const saved = await saveItemMediaLinks({
      projectId,
      entityType,
      entityId,
      links: next,
    });
    setLinks(saved);
    onDraftsChange?.(draftsFromLinks(saved));
  }

  async function unlink(link: MediaLink) {
    const next = draftsFromLinks(links).filter((draft) =>
      draft.kind === 'media'
        ? draft.mediaId !== link.mediaId
        : draft.url !== link.url,
    );
    setError(null);
    try {
      if (immediate) await commit(next);
      else {
        setLinks((current) => current.filter((row) => row.id !== link.id));
        onDraftsChange?.(next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mediaUploadFailed'));
    }
  }

  async function addUrl() {
    const title = urlTitle.trim();
    const url = urlValue.trim();
    if (!title || !url) return;
    if (!/^https?:\/\//i.test(url)) {
      setError(t('mediaUrlInvalid'));
      return;
    }
    setError(null);
    const next = [
      ...draftsFromLinks(links),
      { kind: 'url' as const, url, title, description: urlDescription.trim() || null },
    ];
    try {
      if (immediate) await commit(next);
      else {
        setLinks((current) => [
          ...current,
          {
            id: `local-url-${url}`,
            kind: 'url',
            title,
            description: urlDescription.trim() || null,
            url,
            filename: null,
            byteSize: null,
            mediaId: null,
            deleted: false,
          },
        ]);
        onDraftsChange?.(next);
      }
      setUrlTitle('');
      setUrlValue('');
      setUrlDescription('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('mediaUploadFailed'));
    }
  }

  async function addMediaIds(ids: string[], names: Map<string, LibraryItem>) {
    const existing = new Set(
      draftsFromLinks(links).flatMap((draft) =>
        draft.kind === 'media' ? [draft.mediaId] : [],
      ),
    );
    const added = ids.filter((id) => !existing.has(id));
    const next = [
      ...draftsFromLinks(links),
      ...added.map((mediaId) => ({ kind: 'media' as const, mediaId })),
    ];
    if (immediate) {
      await commit(next);
      return;
    }
    setLinks((current) => [
      ...current,
      ...added.map((mediaId) => {
        const item = names.get(mediaId);
        return {
          id: `local-media-${mediaId}`,
          kind: 'media' as const,
          title: item?.originalFilename ?? null,
          description: null,
          url: item?.url ?? `/api/v1/media/${mediaId}`,
          filename: item?.originalFilename ?? null,
          byteSize: item?.byteSize ?? null,
          mediaId,
          deleted: false,
        };
      }),
    ]);
    onDraftsChange?.(next);
  }

  async function uploadFiles(files: File[]) {
    if (!workspaceId) return;
    setError(null);
    for (const file of files) {
      setUploading(file.name);
      const body = new FormData();
      body.set('file', file);
      body.set('contentType', file.type);
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/media`, {
        method: 'POST',
        credentials: 'include',
        headers: { Origin: window.location.origin },
        body,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        media?: LibraryItem & { id: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.media) {
        setError(payload.error?.message || t('mediaUploadFailed'));
        continue;
      }
      try {
        await addMediaIds([payload.media.id], new Map([[payload.media.id, payload.media]]));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('mediaUploadFailed'));
      }
    }
    setUploading(null);
  }

  async function deleteFromLibrary(mediaId: string) {
    const response = await fetch(`/api/v1/media/${mediaId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Origin: window.location.origin },
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      setError(payload.error?.message || t('mediaUploadFailed'));
      return;
    }
    setConfirmDeleteId(null);
    setLinks((current) =>
      current.map((link) =>
        link.mediaId === mediaId
          ? { ...link, deleted: true, url: null }
          : link,
      ),
    );
  }

  async function openPicker() {
    if (!workspaceId) return;
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/media?limit=100`,
      { credentials: 'include' },
    );
    const payload = (await response.json().catch(() => ({}))) as {
      media?: LibraryItem[];
    };
    setLibrary(payload.media ?? []);
    setQuery('');
    setTypeFilter('all');
    setPicked([]);
    setPage(1);
    setPickerOpen(true);
  }

  const linkedMediaIds = new Set(
    links.flatMap((link) =>
      link.kind === 'media' && link.mediaId ? [link.mediaId] : [],
    ),
  );
  const needle = query.trim().toLowerCase();
  const mediaTypes = MEDIA_TYPE_ORDER.filter((type) =>
    library.some((item) => item.contentType === type),
  );
  const available = library.filter((item) => {
    if (linkedMediaIds.has(item.id)) return false;
    if (typeFilter !== 'all' && item.contentType !== typeFilter) return false;
    if (!needle) return true;
    return (item.originalFilename ?? '').toLowerCase().includes(needle);
  });
  const totalPages = Math.max(1, Math.ceil(available.length / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = available.slice(pageStart, pageStart + pageSize);
  const editable = canEdit && !disabled;
  const imageLightboxItems = useMemo<MediaLightboxItem[]>(
    () =>
      links
        .filter(
          (link) =>
            link.kind === 'media' && Boolean(link.url) && !link.deleted,
        )
        .map((link) => ({
          id: link.id,
          url: link.url!,
          title: link.title ?? link.filename,
          alt: link.title ?? link.filename,
        })),
    [links],
  );

  return (
    <div className="grid gap-3">
      {links.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">{t('mediaEmpty')}</p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {links.map((link) => (
            <li key={link.id} className="kh-ops-media-row">
              {link.kind === 'media' && link.url && !link.deleted ? (
                <button
                  type="button"
                  onClick={() => {
                    const index = imageLightboxItems.findIndex(
                      (item) => item.id === link.id,
                    );
                    if (index >= 0) setLightboxIndex(index);
                  }}
                >
                  <img
                    className="kh-ops-media-thumb"
                    src={link.url}
                    alt={link.title ?? link.filename ?? ''}
                  />
                </button>
              ) : (
                <span className="kh-ops-media-thumb" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                {link.kind === 'url' && link.url ? (
                  <a href={link.url} target="_blank" rel="noopener noreferrer">
                    {link.title}
                  </a>
                ) : (
                  <strong className="block truncate">
                    {link.deleted ? t('mediaDeleted') : link.title || link.filename}
                  </strong>
                )}
                {link.byteSize != null ? (
                  <small className="text-ink-muted">
                    {Math.ceil(link.byteSize / 1024)} KB
                  </small>
                ) : null}
              </div>
              {editable ? (
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => void unlink(link)}>
                    {t('mediaUnlink')}
                  </Button>
                  {link.kind === 'media' && link.mediaId && !link.deleted ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setConfirmDeleteId(link.mediaId)}
                    >
                      {t('mediaDeleteLibrary')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {confirmDeleteId ? (
        <div className="kh-ops-confirm">
          <p className="m-0 text-sm">{t('mediaDeleteConfirm')}</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" onClick={() => void deleteFromLibrary(confirmDeleteId)}>
              {t('mediaDeleteLibrary')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmDeleteId(null)}>
              {tCommon('cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
      {editable ? (
        <>
          <div
            className={`kh-ops-dropzone kh-ops-media-drop${dragActive ? ' is-active' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              void uploadFiles([...event.dataTransfer.files]);
            }}
          >
            <strong>{uploading ? t('mediaUploading', { name: uploading }) : t('mediaUpload')}</strong>
            <p>{t('mediaAllowedTypes')}</p>
            <p>{t('mediaDrop')}</p>
            <div className="kh-ops-media-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={!workspaceId || Boolean(uploading)}
                onClick={() => fileInputRef.current?.click()}
              >
                {t('mediaChoose')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!workspaceId || Boolean(uploading)}
                onClick={() => void openPicker()}
              >
                {t('mediaLinkExisting')}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              tabIndex={-1}
              aria-label={t('mediaChoose')}
              disabled={!workspaceId || Boolean(uploading)}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                void uploadFiles(files);
              }}
            />
          </div>
          <div className="kh-ops-form-grid">
            <Field className="kh-ops-field-span" label={t('mediaUrlTitle')}>
              <Input value={urlTitle} onChange={(event) => setUrlTitle(event.target.value)} />
            </Field>
            <Field className="kh-ops-field-span" label={t('mediaUrlAddress')}>
              <Input
                value={urlValue}
                inputMode="url"
                placeholder="https://"
                onChange={(event) => setUrlValue(event.target.value)}
              />
            </Field>
            <Field className="kh-ops-field-span" label={t('mediaDescription')}>
              <Input
                value={urlDescription}
                onChange={(event) => setUrlDescription(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void addUrl()}>
              {t('mediaAddUrl')}
            </Button>
          </div>
        </>
      ) : null}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        size="wide"
        title={t('mediaAddTitle')}
        description={t('mediaAddDescription')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setPickerOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                const names = new Map(library.map((item) => [item.id, item]));
                void addMediaIds(picked, names)
                  .then(() => setPickerOpen(false))
                  .catch((cause: unknown) => {
                    setError(cause instanceof Error ? cause.message : t('mediaUploadFailed'));
                  });
              }}
            >
              {tRaid('documentsAddConfirm')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={t('mediaSearch')}
              data-modal-initial-focus
              className="min-w-[12rem] flex-1"
            />
            <Select
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
              aria-label={tRaid('itemsTypeFilter')}
              className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
            >
              <option value="all">{tRaid('itemsTypeAll')}</option>
              {mediaTypes.map((type) => (
                <option key={type} value={type}>
                  {MEDIA_TYPE_LABELS[type] ?? type}
                </option>
              ))}
            </Select>
          </div>
          {available.length === 0 ? (
            <p className="m-0 text-sm text-ink-muted">
              {t(
                needle || typeFilter !== 'all'
                  ? 'mediaNoneToAdd'
                  : library.length === 0
                    ? 'mediaLibraryEmpty'
                    : 'mediaAllLinked',
              )}
            </p>
          ) : (
            <>
              <ul className="m-0 grid list-none gap-2 p-0">
                {pageItems.map((item) => (
                  <li key={item.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={picked.includes(item.id)}
                        onChange={() => {
                          setPicked((current) => (
                            current.includes(item.id)
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id]
                          ));
                        }}
                      />
                      <img className="kh-ops-media-thumb kh-ops-media-thumb-sm" src={item.url} alt="" />
                      <span>{item.originalFilename || item.id}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <p className="m-0 text-xs text-ink-muted">
                  {tRaid('documentsShowing', {
                    from: available.length === 0 ? 0 : pageStart + 1,
                    to: Math.min(pageStart + pageSize, available.length),
                    total: available.length,
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    value={String(pageSize)}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      setPageSize(isPageSize(parsed) ? parsed : 5);
                      setPage(1);
                    }}
                    aria-label={tRaid('documentsPageSize')}
                    className="h-10 min-h-10 w-auto min-w-[9rem] py-1.5 text-xs"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={String(size)}>
                        {tRaid('documentsPageSizeOption', { count: size })}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                  >
                    {tRaid('documentsPrevPage')}
                  </Button>
                  <span className="text-xs text-ink-muted">{currentPage} / {totalPages}</span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  >
                    {tRaid('documentsNextPage')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
      <MediaLightbox
        open={lightboxIndex !== null && imageLightboxItems.length > 0}
        items={imageLightboxItems}
        index={lightboxIndex ?? 0}
        onClose={() => setLightboxIndex(null)}
        onIndexChange={setLightboxIndex}
      />
    </div>
  );
}
