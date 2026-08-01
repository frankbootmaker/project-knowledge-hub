'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Input,
  Panel,
  PasswordInput,
  Select,
  useToast,
} from '../ui';

export type PublicLlmProvider = {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel: string;
  timeoutMs: number | null;
  status: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicLlmBinding = {
  service: string;
  providerId: string | null;
  providerName: string | null;
  modelOverride: string | null;
  active: boolean;
  available: boolean;
  source: 'binding' | 'env' | 'none';
  effectiveModel: string | null;
};

type DraftProvider = {
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKey: string;
  timeoutMs: string;
  status: 'active' | 'disabled';
};

const emptyDraft = (): DraftProvider => ({
  name: '',
  baseUrl: 'http://127.0.0.1:11434/v1',
  defaultModel: 'llama3.2',
  apiKey: '',
  timeoutMs: '',
  status: 'active',
});

function serviceLabel(
  service: string,
  t: ReturnType<typeof useTranslations<'admin'>>,
): string {
  if (service === 'translation') return t('aiServiceTranslation');
  if (service === 'vision_ocr') return t('aiServiceVisionOcr');
  if (service === 'doc_forge') return t('aiServiceDocForge');
  if (service === 'embeddings') return t('aiServiceEmbeddings');
  return service;
}

export function AiProvidersAdmin({
  initialProviders,
  initialBindings,
}: {
  initialProviders: PublicLlmProvider[];
  initialBindings: PublicLlmBinding[];
}) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();

  const [providers, setProviders] = useState(initialProviders);
  const [bindings, setBindings] = useState(initialBindings);
  const [draft, setDraft] = useState<DraftProvider>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftProvider | null>(null);
  const [bindingDraft, setBindingDraft] = useState(() =>
    Object.fromEntries(
      initialBindings.map((row) => [
        row.service,
        {
          providerId: row.providerId ?? '',
          modelOverride: row.modelOverride ?? '',
        },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const activeProviders = useMemo(
    () => providers.filter((row) => row.status === 'active'),
    [providers],
  );

  async function createProvider() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/llm-providers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(),
          baseUrl: draft.baseUrl.trim(),
          defaultModel: draft.defaultModel.trim(),
          apiKey: draft.apiKey.trim() || null,
          timeoutMs: draft.timeoutMs.trim()
            ? Number(draft.timeoutMs.trim())
            : null,
          status: draft.status,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        provider?: PublicLlmProvider;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (body.provider) {
        setProviders((prev) =>
          [...prev, body.provider!].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      setDraft(emptyDraft());
      pushToast(t('aiProviderCreated'));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProvidersFailed'));
    } finally {
      setPending(false);
    }
  }

  async function saveEdit() {
    if (!editingId || !editDraft) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/llm-providers/${editingId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editDraft.name.trim(),
          baseUrl: editDraft.baseUrl.trim(),
          defaultModel: editDraft.defaultModel.trim(),
          apiKey: editDraft.apiKey.trim() ? editDraft.apiKey.trim() : undefined,
          timeoutMs: editDraft.timeoutMs.trim()
            ? Number(editDraft.timeoutMs.trim())
            : null,
          status: editDraft.status,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        provider?: PublicLlmProvider;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (body.provider) {
        setProviders((prev) =>
          prev
            .map((row) => (row.id === body.provider!.id ? body.provider! : row))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      setEditingId(null);
      setEditDraft(null);
      pushToast(t('aiProviderUpdated'));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProvidersFailed'));
    } finally {
      setPending(false);
    }
  }

  async function testProvider(providerId: string) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/llm-providers/${providerId}/test`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        model?: string;
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      pushToast(t('aiProviderTestOk', { model: body.model ?? '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProviderTestFailed'));
    } finally {
      setPending(false);
    }
  }

  async function removeProvider(providerId: string) {
    if (!window.confirm(t('aiProviderDeleteConfirm'))) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/llm-providers/${providerId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      setProviders((prev) => prev.filter((row) => row.id !== providerId));
      pushToast(t('aiProviderDeleted'));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProvidersFailed'));
    } finally {
      setPending(false);
    }
  }

  async function saveBindings() {
    setPending(true);
    setError(null);
    try {
      const payload = bindings
        .filter((row) => row.active)
        .map((row) => {
          const draftRow = bindingDraft[row.service] ?? {
            providerId: '',
            modelOverride: '',
          };
          return {
            service: row.service as 'translation' | 'vision_ocr',
            providerId: draftRow.providerId.trim()
              ? draftRow.providerId.trim()
              : null,
            modelOverride: draftRow.modelOverride.trim()
              ? draftRow.modelOverride.trim()
              : null,
          };
        });

      const response = await fetch('/api/v1/admin/llm-service-bindings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bindings: payload }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: { message?: string };
        bindings?: PublicLlmBinding[];
      };
      if (!response.ok) {
        throw new Error(body.error?.message ?? `HTTP ${response.status}`);
      }
      if (body.bindings) {
        setBindings(body.bindings);
        setBindingDraft(
          Object.fromEntries(
            body.bindings.map((row) => [
              row.service,
              {
                providerId: row.providerId ?? '',
                modelOverride: row.modelOverride ?? '',
              },
            ]),
          ),
        );
      }
      pushToast(t('aiBindingsSaved'));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiProvidersFailed'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Panel className="grid gap-4 p-5">
        <p className="m-0 text-sm text-ink-muted">{t('aiProvidersBlurb')}</p>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Panel>

      <Panel className="grid gap-4 p-5">
        <h2 className="m-0 text-base font-semibold text-ink">
          {t('aiProvidersListTitle')}
        </h2>
        {providers.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">{t('aiProvidersEmpty')}</p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {providers.map((provider) => {
              const editing = editingId === provider.id;
              return (
                <li
                  key={provider.id}
                  className="grid gap-3 rounded-md border border-line bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-ink">{provider.name}</strong>
                      <Badge
                        tone={provider.status === 'active' ? 'brand' : 'neutral'}
                      >
                        {provider.status}
                      </Badge>
                      <span className="text-sm text-ink-muted">
                        {provider.defaultModel}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => void testProvider(provider.id)}
                      >
                        {t('aiProviderTest')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => {
                          if (editing) {
                            setEditingId(null);
                            setEditDraft(null);
                            return;
                          }
                          setEditingId(provider.id);
                          setEditDraft({
                            name: provider.name,
                            baseUrl: provider.baseUrl,
                            defaultModel: provider.defaultModel,
                            apiKey: '',
                            timeoutMs:
                              provider.timeoutMs != null
                                ? String(provider.timeoutMs)
                                : '',
                            status:
                              provider.status === 'disabled'
                                ? 'disabled'
                                : 'active',
                          });
                        }}
                      >
                        {editing ? tCommon('cancel') : tCommon('edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => void removeProvider(provider.id)}
                      >
                        {t('aiProviderDelete')}
                      </Button>
                    </div>
                  </div>
                  <p className="m-0 font-mono text-xs text-ink-muted break-all">
                    {provider.baseUrl}
                  </p>
                  {editing && editDraft ? (
                    <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-2">
                      <Field label={t('aiProviderName')}>
                        <Input
                          value={editDraft.name}
                          disabled={pending}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, name: e.target.value })
                          }
                        />
                      </Field>
                      <Field label={t('aiProviderModel')}>
                        <Input
                          value={editDraft.defaultModel}
                          disabled={pending}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              defaultModel: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label={t('aiProviderBaseUrl')}>
                        <Input
                          value={editDraft.baseUrl}
                          disabled={pending}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              baseUrl: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <div className="grid gap-1">
                        <Field label={t('aiProviderApiKey')}>
                          <PasswordInput
                            value={editDraft.apiKey}
                            disabled={pending}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                apiKey: e.target.value,
                              })
                            }
                            autoComplete="new-password"
                          />
                        </Field>
                        {provider.hasApiKey ? (
                          <p className="m-0 text-xs text-ink-muted">
                            {t('aiProviderApiKeyKeepHint')}
                          </p>
                        ) : null}
                      </div>
                      <Field label={t('aiProviderStatus')}>
                        <Select
                          value={editDraft.status}
                          disabled={pending}
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              status: e.target.value as 'active' | 'disabled',
                            })
                          }
                        >
                          <option value="active">{t('aiProviderStatusActive')}</option>
                          <option value="disabled">
                            {t('aiProviderStatusDisabled')}
                          </option>
                        </Select>
                      </Field>
                      <Field label={t('aiProviderTimeout')}>
                        <Input
                          value={editDraft.timeoutMs}
                          disabled={pending}
                          placeholder="120000"
                          onChange={(e) =>
                            setEditDraft({
                              ...editDraft,
                              timeoutMs: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <div className="md:col-span-2">
                        <Button
                          type="button"
                          disabled={pending}
                          onClick={() => void saveEdit()}
                        >
                          {tCommon('save')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="grid gap-4 p-5">
        <h2 className="m-0 text-base font-semibold text-ink">
          {t('aiProviderCreateTitle')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('aiProviderName')}>
            <Input
              value={draft.name}
              disabled={pending}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label={t('aiProviderModel')}>
            <Input
              value={draft.defaultModel}
              disabled={pending}
              onChange={(e) =>
                setDraft({ ...draft, defaultModel: e.target.value })
              }
            />
          </Field>
          <Field label={t('aiProviderBaseUrl')}>
            <Input
              value={draft.baseUrl}
              disabled={pending}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            />
          </Field>
          <Field label={t('aiProviderApiKey')}>
            <PasswordInput
              value={draft.apiKey}
              disabled={pending}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <div>
          <Button
            type="button"
            disabled={
              pending ||
              !draft.name.trim() ||
              !draft.baseUrl.trim() ||
              !draft.defaultModel.trim()
            }
            onClick={() => void createProvider()}
          >
            {t('aiProviderCreate')}
          </Button>
        </div>
      </Panel>

      <Panel className="grid gap-4 p-5">
        <h2 className="m-0 text-base font-semibold text-ink">
          {t('aiBindingsTitle')}
        </h2>
        <p className="m-0 text-sm text-ink-muted">{t('aiBindingsBlurb')}</p>
        <ul className="m-0 grid list-none gap-3 p-0">
          {bindings.map((row) => {
            const draftRow = bindingDraft[row.service] ?? {
              providerId: '',
              modelOverride: '',
            };
            return (
              <li
                key={row.service}
                className="grid gap-3 rounded-md border border-line bg-surface px-4 py-3 md:grid-cols-[1fr_1.2fr_1fr_auto]"
              >
                <div>
                  <strong className="text-ink">{serviceLabel(row.service, t)}</strong>
                  <p className="m-0 mt-1 text-xs text-ink-muted">
                    {row.active
                      ? t('aiBindingSource', { source: row.source })
                      : t('aiBindingLater')}
                  </p>
                </div>
                <Field label={t('aiBindingProvider')}>
                  <Select
                    value={draftRow.providerId}
                    disabled={pending || !row.active}
                    onChange={(e) =>
                      setBindingDraft((prev) => ({
                        ...prev,
                        [row.service]: {
                          ...draftRow,
                          providerId: e.target.value,
                        },
                      }))
                    }
                  >
                    <option value="">{t('aiBindingEnvFallback')}</option>
                    {activeProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('aiBindingModelOverride')}>
                  <Input
                    value={draftRow.modelOverride}
                    disabled={pending || !row.active}
                    placeholder={t('aiBindingModelOverridePlaceholder')}
                    onChange={(e) =>
                      setBindingDraft((prev) => ({
                        ...prev,
                        [row.service]: {
                          ...draftRow,
                          modelOverride: e.target.value,
                        },
                      }))
                    }
                  />
                </Field>
                <div className="flex items-end">
                  <Badge tone={row.available ? 'brand' : 'neutral'}>
                    {row.available
                      ? t('aiBindingAvailable')
                      : t('aiBindingUnavailable')}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
        <div>
          <Button
            type="button"
            disabled={pending}
            onClick={() => void saveBindings()}
          >
            {t('aiBindingsSave')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
