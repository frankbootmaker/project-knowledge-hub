'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Textarea,
  useToast,
} from './ui';

const STATUSES = ['planned', 'active', 'done', 'cancelled'] as const;

type Epic = {
  id: string;
  title: string;
  description: string | null;
  status: string;
};

type Story = {
  id: string;
  epicId: string;
  title: string;
  description: string | null;
  status: string;
};

export function ProjectAgileManageModal({
  open,
  onClose,
  kind,
  itemId,
  epics,
  stories,
  canMutate,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'epic' | 'story' | null;
  itemId: string | null;
  epics: Epic[];
  stories: Story[];
  canMutate: boolean;
  onSaved: (kind: 'epic' | 'story', item: Epic | Story) => void;
  onDeleted: (kind: 'epic' | 'story', id: string) => void;
}) {
  const t = useTranslations('delivery');
  const tCommon = useTranslations('common');
  const tArchive = useTranslations('archive');
  const { pushToast } = useToast();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('planned');
  const [epicId, setEpicId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  useEffect(() => {
    if (!open || !kind || !itemId) {
      setConfirmDelete(false);
      setDeleteAcknowledged(false);
      setError(null);
      return;
    }
    if (kind === 'epic') {
      const epic = epics.find((row) => row.id === itemId);
      if (!epic) return;
      setTitle(epic.title);
      setDescription(epic.description ?? '');
      setStatus(epic.status);
      setEpicId('');
    } else {
      const story = stories.find((row) => row.id === itemId);
      if (!story) return;
      setTitle(story.title);
      setDescription(story.description ?? '');
      setStatus(story.status);
      setEpicId(story.epicId);
    }
    setConfirmDelete(false);
    setDeleteAcknowledged(false);
    setError(null);
  }, [open, kind, itemId, epics, stories]);

  async function save() {
    if (!kind || !itemId || !canMutate || !title.trim()) return;
    if (kind === 'story' && !epicId) return;
    setPending(true);
    setError(null);
    try {
      const path =
        kind === 'epic'
          ? `/api/v1/project-epics/${itemId}`
          : `/api/v1/project-user-stories/${itemId}`;
      const body =
        kind === 'epic'
          ? {
              title: title.trim(),
              description: description.trim() || null,
              status,
            }
          : {
              title: title.trim(),
              description: description.trim() || null,
              status,
              epicId,
            };
      const response = await fetch(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        epic?: Epic;
        userStory?: Story;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ||
            (kind === 'epic' ? t('failedUpdateEpic') : t('failedUpdateStory')),
        );
      }
      const saved = kind === 'epic' ? payload.epic : payload.userStory;
      if (!saved) {
        throw new Error(
          kind === 'epic' ? t('failedUpdateEpic') : t('failedUpdateStory'),
        );
      }
      onSaved(kind, saved);
      pushToast(
        kind === 'epic' ? t('epicUpdated') : t('storyUpdated'),
        'success',
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : kind === 'epic'
            ? t('failedUpdateEpic')
            : t('failedUpdateStory'),
      );
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!kind || !itemId || !canMutate) return;
    setPending(true);
    setError(null);
    try {
      const path =
        kind === 'epic'
          ? `/api/v1/project-epics/${itemId}`
          : `/api/v1/project-user-stories/${itemId}`;
      const response = await fetch(path, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(
          payload.error?.message ||
            (kind === 'epic' ? t('failedDeleteEpic') : t('failedDeleteStory')),
        );
      }
      onDeleted(kind, itemId);
      pushToast(
        kind === 'epic' ? t('epicDeleted') : t('storyDeleted'),
        'success',
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : kind === 'epic'
            ? t('failedDeleteEpic')
            : t('failedDeleteStory'),
      );
    } finally {
      setPending(false);
      setConfirmDelete(false);
    }
  }

  const modalTitle =
    kind === 'epic'
      ? t('manageEpic')
      : kind === 'story'
        ? t('manageStory')
        : t('manage');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title.trim() || modalTitle}
      description={
        kind === 'epic'
          ? t('manageEpicDescription')
          : t('manageStoryDescription')
      }
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div>
            {canMutate ? (
              !confirmDelete ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    setConfirmDelete(true);
                    setDeleteAcknowledged(false);
                  }}
                >
                  {t('deleteItem')}
                </Button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setConfirmDelete(false);
                      setDeleteAcknowledged(false);
                    }}
                  >
                    {tCommon('cancel')}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={pending || !deleteAcknowledged}
                    onClick={() => void remove()}
                  >
                    {kind === 'epic'
                      ? t('confirmDeleteEpic')
                      : t('confirmDeleteStory')}
                  </Button>
                </div>
              )
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            {canMutate ? (
              <Button
                type="button"
                disabled={
                  pending ||
                  !title.trim() ||
                  (kind === 'story' && !epicId) ||
                  confirmDelete
                }
                onClick={() => void save()}
              >
                {kind === 'epic' ? t('saveEpic') : t('saveStory')}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="mb-3">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
      {confirmDelete ? (
        <Panel
          variant="inset"
          className="mb-3 grid gap-3 border-danger/40 bg-danger/5"
        >
          <p className="m-0 text-sm font-semibold text-danger">
            {kind === 'epic'
              ? t('confirmDeleteEpicTitle', { title: title.trim() || t('kindEpic') })
              : t('confirmDeleteStoryTitle', {
                  title: title.trim() || t('kindStory'),
                })}
          </p>
          <p className="m-0 text-sm text-danger">
            {kind === 'epic' ? t('deleteEpicHint') : t('deleteStoryHint')}
          </p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={deleteAcknowledged}
              disabled={pending}
              onChange={(event) => setDeleteAcknowledged(event.target.checked)}
            />
            <span>{tArchive('deleteAcknowledge')}</span>
          </label>
        </Panel>
      ) : null}
      <div className="grid gap-3">
        <Field label={kind === 'epic' ? t('epicTitle') : t('storyTitle')}>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
            data-modal-initial-focus
          />
        </Field>
        {kind === 'story' ? (
          <Field label={t('kindEpic')}>
            <Select
              value={epicId}
              onChange={(e) => setEpicId(e.target.value)}
              disabled={pending || !canMutate || confirmDelete}
            >
              <option value="">{t('selectEpic')}</option>
              {epics.map((epic) => (
                <option key={epic.id} value={epic.id}>
                  {epic.title}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={t('filterStatus')}>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`milestoneStatus.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('description')}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending || !canMutate || confirmDelete}
            rows={4}
          />
        </Field>
      </div>
    </Modal>
  );
}
