'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WORKSPACE_DESCRIPTION_MAX_LENGTH } from '@project-knowledge-hub/domain';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { WorkspaceColorPicker } from './WorkspaceColorPicker';
import {
  WORKSPACE_COLORS,
  type WorkspaceColor,
} from '../lib/workspace-colors';
import { Button, ErrorText, Field, Modal, Textarea, useToast } from './ui';

function asStoredColor(value: string | null): WorkspaceColor | null {
  if (value == null) return null;
  return (WORKSPACE_COLORS as readonly string[]).includes(value)
    ? (value as WorkspaceColor)
    : null;
}

export type WorkspaceDetailsInfo = {
  id: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  ownerNames: string[];
  projectCount: number;
  systemCount: number;
  recordCount: number;
  gitConnectionCount: number;
  memberAdminCount: number;
};

type Section = 'menu' | 'details' | 'color' | 'archive';

const menuItemClass =
  'kh-panel-inset flex w-full cursor-pointer items-center justify-between gap-3 border border-line bg-panel-solid text-left transition hover:border-brand/35';

const menuLinkClass =
  'kh-panel-inset flex items-center justify-between gap-3 no-underline transition hover:border-brand/35';

function DetailRow(props: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3">
      <dt className="text-sm text-ink-muted">{props.label}</dt>
      <dd
        className={
          props.mono
            ? 'm-0 break-all font-mono text-sm text-ink'
            : 'm-0 text-sm text-ink'
        }
      >
        {props.value}
      </dd>
    </div>
  );
}

export function WorkspaceManageMenu(props: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  archived: boolean;
  color: string | null;
  canManageArchive: boolean;
  canManageColor: boolean;
  canEditDetails: boolean;
  gitHealthLabel?: string | null;
  details: WorkspaceDetailsInfo;
}) {
  const t = useTranslations('workspaces');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>('menu');
  const [color, setColor] = useState<WorkspaceColor | null>(
    asStoredColor(props.color),
  );
  const [colorError, setColorError] = useState<string | null>(null);
  const [colorPending, setColorPending] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(
    props.details.description ?? '',
  );
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [descriptionPending, setDescriptionPending] = useState(false);

  useEffect(() => {
    if (!editingDescription) {
      setDescriptionDraft(props.details.description ?? '');
    }
  }, [props.details.description, editingDescription]);

  function close() {
    setOpen(false);
    setSection('menu');
    setColorError(null);
    setColor(asStoredColor(props.color));
    setEditingDescription(false);
    setDescriptionError(null);
    setDescriptionDraft(props.details.description ?? '');
  }

  function sectionTitle(): string {
    if (section === 'menu') return t('manageTitle');
    if (section === 'details') return t('manageDetails');
    if (section === 'color') return t('colorLabel');
    return props.archived ? t('manageRestore') : t('manageArchive');
  }

  async function saveColor() {
    setColorPending(true);
    setColorError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${props.workspaceId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ color }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedColorSave'));
      }
      pushToast(t('colorSaved'));
      router.refresh();
      setSection('menu');
    } catch (err) {
      setColorError(err instanceof Error ? err.message : t('failedColorSave'));
    } finally {
      setColorPending(false);
    }
  }

  async function saveDescription() {
    const trimmed = descriptionDraft.trim();
    if (trimmed.length > WORKSPACE_DESCRIPTION_MAX_LENGTH) {
      setDescriptionError(
        t('descriptionTooLong', { max: WORKSPACE_DESCRIPTION_MAX_LENGTH }),
      );
      return;
    }
    setDescriptionPending(true);
    setDescriptionError(null);
    try {
      const response = await fetch(`/api/v1/workspaces/${props.workspaceId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify({ description: trimmed.length > 0 ? trimmed : null }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failedDescriptionSave'));
      }
      pushToast(t('descriptionSaved'));
      setEditingDescription(false);
      router.refresh();
    } catch (err) {
      setDescriptionError(
        err instanceof Error ? err.message : t('failedDescriptionSave'),
      );
    } finally {
      setDescriptionPending(false);
    }
  }

  const { details } = props;
  const ownersLabel =
    details.ownerNames.length > 0
      ? details.ownerNames.join(', ')
      : tCommon('none');

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t('manage')}
      </Button>

      <Modal
        open={open}
        onClose={close}
        title={sectionTitle()}
        description={section === 'menu' ? t('manageDescription') : undefined}
        size="md"
      >
        {section === 'menu' ? (
          <ul className="m-0 grid list-none gap-2 p-0">
            <li>
              <button
                type="button"
                className={menuItemClass}
                onClick={() => setSection('details')}
              >
                <span>
                  <span className="block font-medium text-ink">{t('manageDetails')}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {t('manageDetailsHint')}
                  </span>
                </span>
                <span className="text-ink-muted" aria-hidden>
                  →
                </span>
              </button>
            </li>
            <li>
              <Link
                href={`/workspaces/${props.workspaceSlug}/git`}
                className={menuLinkClass}
                onClick={close}
              >
                <span>
                  <span className="block font-medium text-ink">{t('manageSync')}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {props.gitHealthLabel
                      ? t('manageSyncDetail', { status: props.gitHealthLabel })
                      : t('manageSyncHint')}
                  </span>
                </span>
                <span className="text-ink-muted" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href={`/workspaces/${props.workspaceSlug}/imports`}
                className={menuLinkClass}
                onClick={close}
              >
                <span>
                  <span className="block font-medium text-ink">{t('manageImports')}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {t('manageImportsHint')}
                  </span>
                </span>
                <span className="text-ink-muted" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            <li>
              <Link
                href={`/workspaces/${props.workspaceSlug}/archived`}
                className={menuLinkClass}
                onClick={close}
              >
                <span>
                  <span className="block font-medium text-ink">
                    {t('manageArchivedItems')}
                  </span>
                  <span className="mt-0.5 block text-sm text-ink-muted">
                    {t('manageArchivedItemsHint')}
                  </span>
                </span>
                <span className="text-ink-muted" aria-hidden>
                  →
                </span>
              </Link>
            </li>
            {props.canManageColor ? (
              <li>
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => setSection('color')}
                >
                  <span>
                    <span className="block font-medium text-ink">{t('colorLabel')}</span>
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      {t('manageColorHint')}
                    </span>
                  </span>
                  <span className="text-ink-muted" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            ) : null}
            {props.canManageArchive ? (
              <li>
                <button
                  type="button"
                  className={menuItemClass}
                  onClick={() => setSection('archive')}
                >
                  <span>
                    <span className="block font-medium text-ink">
                      {props.archived ? t('manageRestore') : t('manageArchive')}
                    </span>
                    <span className="mt-0.5 block text-sm text-ink-muted">
                      {props.archived
                        ? t('manageRestoreHint')
                        : t('manageArchiveHint')}
                    </span>
                  </span>
                  <span className="text-ink-muted" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}

        {section === 'details' ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3">
              <DetailRow label={t('detailsId')} value={details.id} mono />
              <DetailRow label={t('detailsSlug')} value={details.slug} mono />
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-sm font-medium text-ink">
                    {tCommon('description')}
                  </p>
                  {props.canEditDetails && !editingDescription ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setDescriptionDraft(details.description ?? '');
                        setDescriptionError(null);
                        setEditingDescription(true);
                      }}
                    >
                      {tCommon('edit')}
                    </Button>
                  ) : null}
                </div>
                {editingDescription ? (
                  <div className="grid gap-2">
                    <Field label={t('descriptionEditLabel')}>
                      <Textarea
                        autoFocus
                        value={descriptionDraft}
                        maxLength={WORKSPACE_DESCRIPTION_MAX_LENGTH}
                        rows={4}
                        onChange={(event) =>
                          setDescriptionDraft(event.target.value)
                        }
                      />
                      <p className="m-0 text-xs text-ink-muted">
                        {t('descriptionLimit', {
                          count: descriptionDraft.length,
                          max: WORKSPACE_DESCRIPTION_MAX_LENGTH,
                        })}
                      </p>
                    </Field>
                    {descriptionError ? (
                      <ErrorText>{descriptionError}</ErrorText>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={descriptionPending}
                        onClick={() => void saveDescription()}
                      >
                        {descriptionPending
                          ? tCommon('saving')
                          : t('saveDescription')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={descriptionPending}
                        onClick={() => {
                          setEditingDescription(false);
                          setDescriptionError(null);
                          setDescriptionDraft(details.description ?? '');
                        }}
                      >
                        {tCommon('cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="m-0 text-sm text-ink">
                    {details.description?.trim() || t('noDescription')}
                  </p>
                )}
              </div>
              <DetailRow label={t('detailsOwners')} value={ownersLabel} />
              <DetailRow
                label={tCommon('status')}
                value={
                  details.archived ? t('statusArchived') : t('statusHealthy')
                }
              />
              <DetailRow
                label={t('detailsCreated')}
                value={new Date(details.createdAt).toLocaleString()}
              />
              <DetailRow
                label={tCommon('updated')}
                value={new Date(details.updatedAt).toLocaleString()}
              />
            </dl>
            <div>
              <p className="mb-2 mt-0 text-sm font-medium text-ink">
                {t('detailsStats')}
              </p>
              <ul className="m-0 grid list-none gap-1.5 p-0 text-sm text-ink-muted">
                <li>
                  {t('detailsStatProjects', { count: details.projectCount })}
                </li>
                <li>
                  {t('detailsStatSystems', { count: details.systemCount })}
                </li>
                <li>
                  {t('detailsStatRecords', { count: details.recordCount })}
                </li>
                <li>
                  {t('detailsStatGit', { count: details.gitConnectionCount })}
                </li>
                <li>
                  {t('detailsStatAdmins', { count: details.memberAdminCount })}
                </li>
              </ul>
            </div>
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingDescription(false);
                  setDescriptionError(null);
                  setSection('menu');
                }}
              >
                {tCommon('back')}
              </Button>
            </div>
          </div>
        ) : null}

        {section === 'color' ? (
          <div className="grid gap-4">
            <Field label={t('colorLabel')}>
              <p className="mb-2 mt-0 text-sm text-ink-muted">{t('colorHint')}</p>
              <WorkspaceColorPicker
                value={color}
                seed={props.workspaceId}
                onChange={setColor}
                allowAuto
              />
            </Field>
            {colorError ? <ErrorText>{colorError}</ErrorText> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={colorPending}
                onClick={() => void saveColor()}
              >
                {colorPending ? tCommon('saving') : t('saveColor')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={colorPending}
                onClick={() => {
                  setSection('menu');
                  setColorError(null);
                  setColor(asStoredColor(props.color));
                }}
              >
                {tCommon('back')}
              </Button>
            </div>
          </div>
        ) : null}

        {section === 'archive' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">
              {props.archived ? t('manageRestoreHint') : t('manageArchiveHint')}
            </p>
            <ArchiveEntityButton
              kind="workspace"
              entityId={props.workspaceId}
              entityName={props.workspaceName}
              archived={props.archived}
              redirectOnArchive="/workspaces"
            />
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setSection('menu')}
              >
                {tCommon('back')}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
