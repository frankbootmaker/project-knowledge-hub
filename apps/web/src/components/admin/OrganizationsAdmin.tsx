'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Button,
  ErrorText,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  useToast,
} from '../ui';

export type PublicOrganization = {
  id: string;
  name: string;
  slug: string;
  workspaceCount?: number;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  name: string;
  slug: string;
};

export function OrganizationsAdmin({
  initialOrganizations,
}: {
  initialOrganizations: PublicOrganization[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteMode, setDeleteMode] = useState<'transfer' | 'destroy'>('transfer');
  const [destroyStep, setDestroyStep] = useState<1 | 2>(1);
  const [destroyAcknowledged, setDestroyAcknowledged] = useState(false);
  const [transferTargets, setTransferTargets] = useState<Record<string, string>>(
    {},
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      initialOrganizations.map((org) => [
        org.id,
        { name: org.name, slug: org.slug },
      ]),
    ),
  );

  function resetDeleteFlow() {
    setConfirmDeleteId(null);
    setDeleteMode('transfer');
    setDestroyStep(1);
    setDestroyAcknowledged(false);
  }

  useEffect(() => {
    setDrafts(
      Object.fromEntries(
        initialOrganizations.map((org) => [
          org.id,
          { name: org.name, slug: org.slug },
        ]),
      ),
    );
    setConfirmDeleteId(null);
    setDeleteMode('transfer');
    setDestroyStep(1);
    setDestroyAcknowledged(false);
    setTransferTargets((current) => {
      const next: Record<string, string> = {};
      for (const org of initialOrganizations) {
        const others = initialOrganizations.filter((item) => item.id !== org.id);
        next[org.id] =
          current[org.id] && others.some((item) => item.id === current[org.id])
            ? current[org.id]!
            : (others[0]?.id ?? '');
      }
      return next;
    });
  }, [initialOrganizations]);

  function draftFor(org: PublicOrganization): Draft {
    return drafts[org.id] ?? { name: org.name, slug: org.slug };
  }

  function setDraft(orgId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [orgId]: {
        name: current[orgId]?.name ?? '',
        slug: current[orgId]?.slug ?? '',
        ...patch,
      },
    }));
  }

  function otherOrganizations(orgId: string) {
    return initialOrganizations.filter((org) => org.id !== orgId);
  }

  function closeCreateModal() {
    setCreateOpen(false);
    setCreateName('');
    setCreateSlug('');
    setError(null);
  }

  async function createOrganization() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/organizations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          slug: createSlug.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      const name = createName.trim();
      closeCreateModal();
      pushToast(t('toastOrganizationCreated', { name }));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function saveOrganization(org: PublicOrganization) {
    const draft = draftFor(org);
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/organizations/${org.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          slug: draft.slug.trim(),
        }),
      });
      const payload = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      pushToast(t('toastOrganizationSaved', { name: draft.name.trim() }));
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  async function deleteOrganization(org: PublicOrganization) {
    const others = otherOrganizations(org.id);
    const mode = deleteMode;

    if (mode === 'destroy') {
      if (destroyStep !== 2 || !destroyAcknowledged) {
        const message = t('organizationDestroyDoubleConfirmRequired');
        setError(message);
        pushToast(message, 'danger');
        return;
      }
    } else {
      const transferToOrganizationId =
        transferTargets[org.id] ||
        (others.length === 1 ? others[0]?.id : undefined);

      if (others.length > 0 && !transferToOrganizationId) {
        const message = t('organizationTransferRequired');
        setError(message);
        pushToast(message, 'danger');
        return;
      }
    }

    setPending(true);
    setError(null);
    try {
      const body =
        mode === 'destroy'
          ? { mode: 'destroy' as const, confirmDestroy: true as const }
          : {
              mode: 'transfer' as const,
              transferToOrganizationId:
                transferTargets[org.id] ||
                (others.length === 1 ? others[0]?.id : undefined),
            };

      const response = await fetch(`/api/v1/organizations/${org.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Origin: window.location.origin,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        mode?: 'transfer' | 'destroy';
        transfer?: { transferToOrganizationId?: string } | null;
      };
      if (!response.ok) {
        throw new Error(payload.error?.message ?? t('failed'));
      }
      resetDeleteFlow();
      if (payload.mode === 'destroy') {
        pushToast(
          t('toastOrganizationDeletedDestroyed', { name: org.name }),
        );
      } else {
        const target = others.find(
          (item) => item.id === payload.transfer?.transferToOrganizationId,
        );
        if (target) {
          pushToast(
            t('toastOrganizationDeletedTransferred', {
              name: org.name,
              target: target.name,
            }),
          );
        } else {
          pushToast(t('toastOrganizationDeleted', { name: org.name }));
        }
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('failed');
      setError(message);
      pushToast(message, 'danger');
    } finally {
      setPending(false);
    }
  }

  const canDeleteAny = initialOrganizations.length > 1;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="m-0 max-w-xl text-sm text-ink-muted">{t('organizationsBlurb')}</p>
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setCreateOpen(true);
          }}
        >
          {t('createOrganization')}
        </Button>
      </div>

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title={t('createOrganization')}
        description={t('organizationsBlurb')}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={closeCreateModal}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              disabled={pending || !createName.trim()}
              onClick={() => void createOrganization()}
            >
              {t('create')}
            </Button>
          </>
        }
      >
        <Field label={tCommon('name')}>
          <Input
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            required
            maxLength={160}
            data-modal-initial-focus
          />
        </Field>
        <Field label={t('slug')}>
          <Input
            value={createSlug}
            onChange={(e) => setCreateSlug(e.target.value)}
            placeholder={t('slugOptionalHint')}
            maxLength={64}
          />
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Modal>

      <div className="grid gap-3">
        {initialOrganizations.length === 0 ? (
          <p className="kh-muted">{t('emptyOrganizations')}</p>
        ) : (
          initialOrganizations.map((org) => {
            const draft = draftFor(org);
            const dirty =
              draft.name.trim() !== org.name || draft.slug.trim() !== org.slug;
            const confirming = confirmDeleteId === org.id;
            const workspaceCount = org.workspaceCount ?? 0;
            const others = otherOrganizations(org.id);
            const transferTo = transferTargets[org.id] ?? others[0]?.id ?? '';
            const transferLocked = others.length === 1;
            return (
              <Panel key={org.id} className="grid gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="m-0 text-sm font-semibold">{org.name}</p>
                    <p className="mt-1 mb-0 font-mono text-xs text-ink-muted">{org.id}</p>
                    <p className="mt-1 mb-0 text-xs text-ink-muted">
                      {t('organizationWorkspaceCount', { count: workspaceCount })}
                    </p>
                  </div>
                  <p className="m-0 text-xs text-ink-muted">
                    {t('updatedAt')}: {new Date(org.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Field label={tCommon('name')}>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft(org.id, { name: e.target.value })}
                    maxLength={160}
                    disabled={pending}
                  />
                </Field>
                <Field label={t('slug')}>
                  <Input
                    value={draft.slug}
                    onChange={(e) => setDraft(org.id, { slug: e.target.value })}
                    maxLength={64}
                    disabled={pending}
                  />
                </Field>
                <p className="m-0 text-xs text-ink-muted">{t('organizationSlugHint')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={pending || !dirty || !draft.name.trim() || !draft.slug.trim()}
                    onClick={() => void saveOrganization(org)}
                  >
                    {t('saveOrganization')}
                  </Button>
                  {dirty ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        setDraft(org.id, { name: org.name, slug: org.slug })
                      }
                    >
                      {t('resetDraft')}
                    </Button>
                  ) : null}
                  {!confirming ? (
                    <Button
                      type="button"
                      variant="danger"
                      disabled={pending || !canDeleteAny}
                      title={
                        canDeleteAny ? undefined : t('organizationDeleteLastHint')
                      }
                      onClick={() => {
                        setDeleteMode('transfer');
                        setDestroyStep(1);
                        setDestroyAcknowledged(false);
                        setConfirmDeleteId(org.id);
                      }}
                    >
                      {t('deleteOrganization')}
                    </Button>
                  ) : null}
                </div>
                {confirming ? (
                  <Panel variant="inset" className="grid gap-3">
                    <p className="m-0 text-sm text-danger">
                      {t('organizationDeleteConfirm', {
                        name: org.name,
                        count: workspaceCount,
                      })}
                    </p>
                    <fieldset className="m-0 grid gap-2 border-0 p-0">
                      <legend className="mb-1 text-sm font-medium">
                        {t('organizationDeleteDisposition')}
                      </legend>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name={`org-delete-mode-${org.id}`}
                          checked={deleteMode === 'transfer'}
                          disabled={pending}
                          onChange={() => {
                            setDeleteMode('transfer');
                            setDestroyStep(1);
                            setDestroyAcknowledged(false);
                          }}
                        />
                        <span>{t('organizationDeleteModeTransfer')}</span>
                      </label>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name={`org-delete-mode-${org.id}`}
                          checked={deleteMode === 'destroy'}
                          disabled={pending}
                          onChange={() => {
                            setDeleteMode('destroy');
                            setDestroyStep(1);
                            setDestroyAcknowledged(false);
                          }}
                        />
                        <span>{t('organizationDeleteModeDestroy')}</span>
                      </label>
                    </fieldset>

                    {deleteMode === 'transfer' ? (
                      <>
                        {others.length > 0 ? (
                          <Field label={t('organizationTransferTarget')}>
                            <Select
                              value={transferTo}
                              disabled={pending || transferLocked}
                              onChange={(e) =>
                                setTransferTargets((current) => ({
                                  ...current,
                                  [org.id]: e.target.value,
                                }))
                              }
                            >
                              {others.map((target) => (
                                <option key={target.id} value={target.id}>
                                  {target.name} ({target.slug})
                                </option>
                              ))}
                            </Select>
                          </Field>
                        ) : null}
                        <p className="m-0 text-xs text-ink-muted">
                          {transferLocked
                            ? t('organizationTransferAutoHint', {
                                target: others[0]?.name ?? '',
                              })
                            : t('organizationTransferHint')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="danger"
                            disabled={
                              pending || (workspaceCount > 0 && !transferTo)
                            }
                            onClick={() => void deleteOrganization(org)}
                          >
                            {t('confirmDeleteOrganization')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pending}
                            onClick={resetDeleteFlow}
                          >
                            {tCommon('cancel')}
                          </Button>
                        </div>
                      </>
                    ) : destroyStep === 1 ? (
                      <>
                        <p className="m-0 text-sm text-danger">
                          {t('organizationDestroyWarning1', {
                            name: org.name,
                            count: workspaceCount,
                          })}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="danger"
                            disabled={pending}
                            onClick={() => {
                              setDestroyStep(2);
                              setDestroyAcknowledged(false);
                            }}
                          >
                            {t('organizationDestroyContinue')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pending}
                            onClick={resetDeleteFlow}
                          >
                            {tCommon('cancel')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="m-0 text-sm text-danger">
                          {t('organizationDestroyWarning2', {
                            name: org.name,
                          })}
                        </p>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={destroyAcknowledged}
                            disabled={pending}
                            onChange={(e) =>
                              setDestroyAcknowledged(e.target.checked)
                            }
                          />
                          <span>{t('organizationDestroyAcknowledge')}</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="danger"
                            disabled={pending || !destroyAcknowledged}
                            onClick={() => void deleteOrganization(org)}
                          >
                            {t('organizationDestroyConfirmFinal')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => {
                              setDestroyStep(1);
                              setDestroyAcknowledged(false);
                            }}
                          >
                            {t('organizationDestroyBack')}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pending}
                            onClick={resetDeleteFlow}
                          >
                            {tCommon('cancel')}
                          </Button>
                        </div>
                      </>
                    )}
                  </Panel>
                ) : null}
              </Panel>
            );
          })
        )}
      </div>
    </div>
  );
}
