'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WORKSPACE_DESCRIPTION_MAX_LENGTH } from '@project-knowledge-hub/domain';
import { ArchiveEntityButton } from './ArchiveEntityButton';
import { PurgeEntityButton } from './PurgeEntityButton';
import { WorkspaceColorPicker } from './WorkspaceColorPicker';
import {
  ManageDetailRow,
  ManageMenuItem,
  ManageMenuLink,
} from './manage-menu-shared';
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

type Section = 'menu' | 'details' | 'color' | 'archive' | 'delete';

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
    if (section === 'delete') return t('manageDelete');
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
            <ManageMenuItem
              title={t('manageDetails')}
              hint={t('manageDetailsHint')}
              onClick={() => setSection('details')}
            />
            <ManageMenuLink
              href={`/workspaces/${props.workspaceSlug}/git`}
              title={t('manageSync')}
              hint={
                props.gitHealthLabel
                  ? t('manageSyncDetail', { status: props.gitHealthLabel })
                  : t('manageSyncHint')
              }
              onClick={close}
            />
            <ManageMenuLink
              href={`/workspaces/${props.workspaceSlug}/imports`}
              title={t('manageImports')}
              hint={t('manageImportsHint')}
              onClick={close}
            />
            <ManageMenuLink
              href={`/workspaces/${props.workspaceSlug}/archived`}
              title={t('manageArchivedItems')}
              hint={t('manageArchivedItemsHint')}
              onClick={close}
            />
            {props.canManageColor ? (
              <ManageMenuItem
                title={t('colorLabel')}
                hint={t('manageColorHint')}
                onClick={() => setSection('color')}
              />
            ) : null}
            {props.canManageArchive ? (
              <ManageMenuItem
                title={props.archived ? t('manageRestore') : t('manageArchive')}
                hint={
                  props.archived ? t('manageRestoreHint') : t('manageArchiveHint')
                }
                onClick={() => setSection('archive')}
              />
            ) : null}
            {props.canManageArchive ? (
              <ManageMenuItem
                title={t('manageDelete')}
                hint={t('manageDeleteHint')}
                onClick={() => setSection('delete')}
              />
            ) : null}
          </ul>
        ) : null}

        {section === 'details' ? (
          <div className="grid gap-4">
            <dl className="m-0 grid gap-3">
              <ManageDetailRow label={t('detailsId')} value={details.id} mono />
              <ManageDetailRow label={t('detailsSlug')} value={details.slug} mono />
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
              <ManageDetailRow label={t('detailsOwners')} value={ownersLabel} />
              <ManageDetailRow
                label={tCommon('status')}
                value={
                  details.archived ? t('statusArchived') : t('statusHealthy')
                }
              />
              <ManageDetailRow
                label={t('detailsCreated')}
                value={new Date(details.createdAt).toLocaleString()}
              />
              <ManageDetailRow
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

        {section === 'delete' ? (
          <div className="grid gap-4">
            <p className="m-0 text-sm text-ink-muted">{t('manageDeleteHint')}</p>
            <PurgeEntityButton
              kind="workspace"
              entityId={props.workspaceId}
              entityName={props.workspaceName}
              redirectOnPurge="/workspaces"
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
