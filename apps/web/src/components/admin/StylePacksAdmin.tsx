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
  Select,
  useToast,
} from '../ui';
import { StylePackColorField } from './StylePackColorField';

/** Fonts that map reliably to Word/PDF on typical desktops. */
const STYLE_PACK_FONTS = [
  'Calibri',
  'Arial',
  'Helvetica',
  'Segoe UI',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Garamond',
  'Cambria',
  'Courier New',
  'Consolas',
] as const;

function fontOptions(current: string): string[] {
  if (
    current &&
    !STYLE_PACK_FONTS.some(
      (font) => font.toLowerCase() === current.toLowerCase(),
    )
  ) {
    return [current, ...STYLE_PACK_FONTS];
  }
  return [...STYLE_PACK_FONTS];
}

export type PublicStylePack = {
  id: string;
  organizationId: string | null;
  slug: string;
  label: string;
  status: 'active' | 'archived';
  formats: Array<'pdf' | 'docx'>;
  typography: {
    bodyFont?: string;
    headingFont?: string;
    monoFont?: string;
    bodyColor?: string;
    headingColor?: string;
    mutedColor?: string;
  };
  chrome: {
    headerText?: string;
    footerText?: string;
    disclaimer?: string;
    showLogo?: boolean;
    showCoverBrand?: boolean;
    showCoverTitle?: boolean;
    showCoverDetails?: boolean;
    marginTopMm?: number;
    marginBottomMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
  };
  hasLogo: boolean;
  logoContentType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  builtin: boolean;
};

type Props = {
  organizationId: string;
  initialPacks: PublicStylePack[];
};

const emptyForm = {
  label: '',
  slug: '',
  headerText: '',
  footerText: '{title}',
  disclaimer: '',
  bodyFont: 'Calibri',
  headingFont: 'Calibri',
  bodyColor: '#1A1A1A',
  headingColor: '#111111',
  mutedColor: '#5A6270',
  showLogo: true,
  showCoverBrand: true,
  showCoverTitle: true,
  showCoverDetails: true,
};

/** Sentinel for the create-pack editor (not a real style pack id). */
const CREATE_ID = '__new__';

export function StylePacksAdmin({ organizationId, initialPacks }: Props) {
  const t = useTranslations('admin');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { pushToast } = useToast();

  const initialSelected =
    initialPacks.find((pack) => !pack.builtin) ?? initialPacks[0];
  const [packs, setPacks] = useState(initialPacks);
  const [selectedId, setSelectedId] = useState<string>(
    initialSelected?.id ?? CREATE_ID,
  );
  const [form, setForm] = useState(() => {
    if (!initialSelected || initialSelected.builtin) {
      return emptyForm;
    }
    return {
      label: initialSelected.label,
      slug: initialSelected.slug,
      headerText: initialSelected.chrome.headerText ?? '',
      footerText: initialSelected.chrome.footerText ?? '{title}',
      disclaimer: initialSelected.chrome.disclaimer ?? '',
      bodyFont: initialSelected.typography.bodyFont ?? 'Calibri',
      headingFont: initialSelected.typography.headingFont ?? 'Calibri',
      bodyColor: initialSelected.typography.bodyColor ?? '#1A1A1A',
      headingColor: initialSelected.typography.headingColor ?? '#111111',
      mutedColor: initialSelected.typography.mutedColor ?? '#5A6270',
      showLogo: initialSelected.chrome.showLogo ?? true,
      showCoverBrand: initialSelected.chrome.showCoverBrand ?? true,
      showCoverTitle: initialSelected.chrome.showCoverTitle ?? true,
      showCoverDetails: initialSelected.chrome.showCoverDetails ?? true,
    };
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const isCreating = selectedId === CREATE_ID;
  const selected = useMemo(
    () =>
      isCreating
        ? undefined
        : (packs.find((pack) => pack.id === selectedId) ?? packs[0]),
    [packs, selectedId, isCreating],
  );
  /** Blank is read-only; create mode and custom packs are editable. */
  const fieldsDisabled = Boolean(selected?.builtin) && !isCreating;

  function startCreate() {
    setSelectedId(CREATE_ID);
    setForm(emptyForm);
    setLogoFile(null);
    setError(null);
  }

  function loadPackIntoForm(pack: PublicStylePack) {
    setSelectedId(pack.id);
    setLogoFile(null);
    setError(null);
    if (pack.builtin) {
      setForm(emptyForm);
      return;
    }
    setForm({
      label: pack.label,
      slug: pack.slug,
      headerText: pack.chrome.headerText ?? '',
      footerText: pack.chrome.footerText ?? '{title}',
      disclaimer: pack.chrome.disclaimer ?? '',
      bodyFont: pack.typography.bodyFont ?? 'Calibri',
      headingFont: pack.typography.headingFont ?? 'Calibri',
      bodyColor: pack.typography.bodyColor ?? '#1A1A1A',
      headingColor: pack.typography.headingColor ?? '#111111',
      mutedColor: pack.typography.mutedColor ?? '#5A6270',
      showLogo: pack.chrome.showLogo ?? true,
      showCoverBrand: pack.chrome.showCoverBrand ?? true,
      showCoverTitle: pack.chrome.showCoverTitle ?? true,
      showCoverDetails: pack.chrome.showCoverDetails ?? true,
    });
  }

  async function refresh() {
    const response = await fetch(
      `/api/v1/admin/doc-factory/style-packs?organizationId=${organizationId}&includeArchived=true`,
      { credentials: 'include' },
    );
    if (!response.ok) {
      throw new Error(t('templatesLoadFailed'));
    }
    const body = (await response.json()) as { stylePacks: PublicStylePack[] };
    setPacks(body.stylePacks);
    return body.stylePacks;
  }

  async function createPack() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/admin/doc-factory/style-packs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          label: form.label.trim() || 'Corporate',
          slug: form.slug.trim() || undefined,
          typography: {
            bodyFont: form.bodyFont,
            headingFont: form.headingFont,
            bodyColor: form.bodyColor,
            headingColor: form.headingColor,
            mutedColor: form.mutedColor,
          },
          chrome: {
            headerText: form.headerText,
            footerText: form.footerText,
            disclaimer: form.disclaimer,
            showLogo: form.showLogo,
            showCoverBrand: form.showCoverBrand,
            showCoverTitle: form.showCoverTitle,
            showCoverDetails: form.showCoverDetails,
          },
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? t('templatesSaveFailed'));
      }
      const created = (await response.json()) as { stylePack: PublicStylePack };
      pushToast(t('templatesCreated'));
      const next = await refresh();
      const pack = next.find((row) => row.id === created.stylePack.id);
      if (pack) {
        loadPackIntoForm(pack);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templatesSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function savePack() {
    if (!selected || selected.builtin) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: form.label.trim(),
            typography: {
              bodyFont: form.bodyFont,
              headingFont: form.headingFont,
              bodyColor: form.bodyColor,
              headingColor: form.headingColor,
              mutedColor: form.mutedColor,
            },
            chrome: {
              headerText: form.headerText,
              footerText: form.footerText,
              disclaimer: form.disclaimer,
              showLogo: form.showLogo,
              showCoverBrand: form.showCoverBrand,
              showCoverTitle: form.showCoverTitle,
              showCoverDetails: form.showCoverDetails,
            },
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? t('templatesSaveFailed'));
      }
      pushToast(t('templatesSaved'));
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templatesSaveFailed'));
    } finally {
      setPending(false);
    }
  }

  async function archivePack() {
    if (!selected || selected.builtin) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({ status: 'archived' }),
        },
      );
      if (!response.ok) {
        throw new Error(t('templatesArchiveFailed'));
      }
      pushToast(t('templatesArchived'));
      const next = await refresh();
      const fallback =
        next.find((pack) => !pack.builtin) ?? next.find((pack) => pack.builtin);
      if (fallback) {
        loadPackIntoForm(fallback);
      } else {
        startCreate();
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('templatesArchiveFailed'),
      );
    } finally {
      setPending(false);
    }
  }

  async function deletePack() {
    if (!selected || selected.builtin) {
      return;
    }
    const confirmed = window.confirm(
      t('templatesDeleteConfirm', { label: selected.label }),
    );
    if (!confirmed) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { Origin: window.location.origin },
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
          message?: string;
        } | null;
        throw new Error(
          payload?.error?.message ??
            payload?.message ??
            t('templatesDeleteFailed'),
        );
      }
      pushToast(t('templatesDeleted'));
      const next = await refresh();
      const fallback =
        next.find((pack) => !pack.builtin) ?? next.find((pack) => pack.builtin);
      if (fallback) {
        loadPackIntoForm(fallback);
      } else {
        startCreate();
      }
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('templatesDeleteFailed'),
      );
    } finally {
      setPending(false);
    }
  }

  async function uploadLogo() {
    if (!selected || selected.builtin || !logoFile) {
      return;
    }
    const maxBytes = 5 * 1024 * 1024;
    if (logoFile.size === 0) {
      setError(t('templatesLogoEmpty'));
      return;
    }
    if (logoFile.size > maxBytes) {
      setError(t('templatesLogoTooLarge', { maxMb: 5 }));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', logoFile, logoFile.name);
      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}/logo`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { Origin: window.location.origin },
          body,
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
          message?: string;
        } | null;
        throw new Error(
          payload?.error?.message ??
            payload?.message ??
            t('templatesLogoFailed'),
        );
      }
      pushToast(t('templatesLogoUploaded'));
      setLogoFile(null);
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templatesLogoFailed'));
    } finally {
      setPending(false);
    }
  }

  async function preview(format: 'pdf' | 'docx') {
    if (!selected || selected.builtin) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      // Persist the editor first so preview reflects header/footer edits.
      const saveResponse = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: form.label.trim(),
            typography: {
              bodyFont: form.bodyFont,
              headingFont: form.headingFont,
              bodyColor: form.bodyColor,
              headingColor: form.headingColor,
              mutedColor: form.mutedColor,
            },
            chrome: {
              headerText: form.headerText,
              footerText: form.footerText,
              disclaimer: form.disclaimer,
              showLogo: form.showLogo,
              showCoverBrand: form.showCoverBrand,
              showCoverTitle: form.showCoverTitle,
              showCoverDetails: form.showCoverDetails,
            },
          }),
        },
      );
      if (!saveResponse.ok) {
        const body = (await saveResponse.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? t('templatesSaveFailed'));
      }

      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}/preview-export`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ format }),
        },
      );
      if (!response.ok) {
        throw new Error(t('templatesPreviewFailed'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `preview-${selected.slug}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast(t('templatesPreviewOk', { format: format.toUpperCase() }));
      await refresh();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('templatesPreviewFailed'),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[240px_1fr]">
      <Panel className="grid gap-3 self-start p-4">
        <p className="m-0 text-sm font-semibold text-ink">{t('templatesList')}</p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {packs.map((pack) => {
            const active = !isCreating && selectedId === pack.id;
            return (
              <li key={pack.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                    active
                      ? 'border-accent bg-accent/10'
                      : 'border-line bg-surface'
                  }`}
                  onClick={() => loadPackIntoForm(pack)}
                >
                  <span className="min-w-0 truncate">{pack.label}</span>
                  <Badge
                    tone={
                      pack.builtin
                        ? 'neutral'
                        : pack.status === 'active'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {pack.builtin ? t('templatesBuiltin') : pack.status}
                  </Badge>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel className="grid gap-4 self-start p-4">
        <p className="m-0 text-sm text-ink-muted">
          {isCreating
            ? t('templatesCreatingBlurb')
            : selected?.builtin
              ? t('templatesBlankReadOnly')
              : t('templatesEditorBlurb')}
        </p>
        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('templatesLabel')}>
            <Input
              value={form.label}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({ ...current, label: event.target.value }))
              }
            />
          </Field>
          <Field label={t('templatesSlug')}>
            <Input
              value={form.slug}
              disabled={!isCreating}
              placeholder={t('templatesSlugOptional')}
              onChange={(event) =>
                setForm((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </Field>
          <Field label={t('templatesHeaderText')}>
            <Input
              value={form.headerText}
              disabled={fieldsDisabled}
              placeholder={t('templatesHeaderFooterHint')}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  headerText: event.target.value,
                }))
              }
            />
            <p className="m-0 text-xs text-ink-muted">
              {t('templatesResolvesTo', {
                value:
                  form.headerText.trim().length > 0
                    ? form.headerText.replaceAll('{title}', t('templatesTitleSample'))
                    : tCommon('emDash'),
              })}
            </p>
          </Field>
          <Field label={t('templatesFooterText')}>
            <Input
              value={form.footerText}
              disabled={fieldsDisabled}
              placeholder={t('templatesHeaderFooterHint')}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  footerText: event.target.value,
                }))
              }
            />
            <p className="m-0 text-xs text-ink-muted">
              {t('templatesResolvesTo', {
                value:
                  form.footerText.trim().length > 0
                    ? form.footerText.replaceAll('{title}', t('templatesTitleSample'))
                    : tCommon('emDash'),
              })}
            </p>
          </Field>
          <Field label={t('templatesBodyFont')}>
            <Select
              value={form.bodyFont}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  bodyFont: event.target.value,
                }))
              }
            >
              {fontOptions(form.bodyFont).map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('templatesHeadingFont')}>
            <Select
              value={form.headingFont}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  headingFont: event.target.value,
                }))
              }
            >
              {fontOptions(form.headingFont).map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('templatesBodyColor')}>
            <StylePackColorField
              label={t('templatesBodyColor')}
              value={form.bodyColor}
              disabled={fieldsDisabled}
              onChange={(bodyColor) =>
                setForm((current) => ({ ...current, bodyColor }))
              }
            />
          </Field>
          <Field label={t('templatesHeadingColor')}>
            <StylePackColorField
              label={t('templatesHeadingColor')}
              value={form.headingColor}
              disabled={fieldsDisabled}
              onChange={(headingColor) =>
                setForm((current) => ({ ...current, headingColor }))
              }
            />
          </Field>
          <Field label={t('templatesMutedColor')}>
            <StylePackColorField
              label={t('templatesMutedColor')}
              value={form.mutedColor}
              disabled={fieldsDisabled}
              onChange={(mutedColor) =>
                setForm((current) => ({ ...current, mutedColor }))
              }
            />
          </Field>
        </div>

        <Field label={t('templatesDisclaimer')}>
          <Input
            value={form.disclaimer}
            disabled={fieldsDisabled}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                disclaimer: event.target.value,
              }))
            }
          />
        </Field>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.showLogo}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  showLogo: event.target.checked,
                }))
              }
            />
            {t('templatesShowLogo')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.showCoverBrand}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  showCoverBrand: event.target.checked,
                }))
              }
            />
            {t('templatesShowCoverBrand')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.showCoverTitle}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  showCoverTitle: event.target.checked,
                }))
              }
            />
            {t('templatesShowCoverTitle')}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={form.showCoverDetails}
              disabled={fieldsDisabled}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  showCoverDetails: event.target.checked,
                }))
              }
            />
            {t('templatesShowCoverDetails')}
          </label>
        </div>

        {selected && !selected.builtin ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label={t('templatesLogo')}>
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) =>
                  setLogoFile(event.target.files?.[0] ?? null)
                }
              />
            </Field>
            <Button
              type="button"
              variant="secondary"
              disabled={pending || !logoFile}
              onClick={() => void uploadLogo()}
            >
              {t('templatesUploadLogo')}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={pending || isCreating}
            onClick={() => startCreate()}
          >
            {t('templatesNew')}
          </Button>
          {isCreating ? (
            <Button
              type="button"
              disabled={pending || !form.label.trim()}
              onClick={() => void createPack()}
            >
              {t('templatesCreate')}
            </Button>
          ) : selected?.builtin ? null : (
            <>
              <Button
                type="button"
                disabled={pending}
                onClick={() => void savePack()}
              >
                {tCommon('save')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void preview('docx')}
              >
                {t('templatesPreviewDocx')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void preview('pdf')}
              >
                {t('templatesPreviewPdf')}
              </Button>
              {selected?.status === 'active' ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void archivePack()}
                >
                  {t('templatesArchive')}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="danger"
                disabled={pending}
                onClick={() => void deletePack()}
              >
                {t('templatesDelete')}
              </Button>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
