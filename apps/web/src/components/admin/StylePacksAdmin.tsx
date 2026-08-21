'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  FilePicker,
  Input,
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

/** Preview tokens for header/footer/disclaimer (mirrors API interpolator). */
function previewStyleTemplate(
  template: string,
  samples: {
    title: string;
    date: string;
    datetime: string;
    slug: string;
    type: string;
    status: string;
  },
): string {
  return template
    .replaceAll('{title}', samples.title)
    .replaceAll('{date}', samples.date)
    .replaceAll('{datetime}', samples.datetime)
    .replaceAll('{slug}', samples.slug)
    .replaceAll('{type}', samples.type)
    .replaceAll('{status}', samples.status);
}

const STYLE_TEMPLATE_TOKENS = [
  { token: '{title}', descKey: 'templatesTokenDescTitle' },
  { token: '{date}', descKey: 'templatesTokenDescDate' },
  { token: '{datetime}', descKey: 'templatesTokenDescDatetime' },
  { token: '{slug}', descKey: 'templatesTokenDescSlug' },
  { token: '{type}', descKey: 'templatesTokenDescType' },
  { token: '{status}', descKey: 'templatesTokenDescStatus' },
] as const;

function StylePackTokenHints(props: {
  disabled?: boolean;
  onInsert: (token: string) => void;
}) {
  const t = useTranslations('admin');

  return (
    <div className="grid gap-1.5">
      <p className="m-0 text-xs text-ink-muted">{t('templatesAvailableTokens')}</p>
      <div className="flex flex-wrap gap-1.5">
        {STYLE_TEMPLATE_TOKENS.map((item) => (
          <button
            key={item.token}
            type="button"
            disabled={props.disabled}
            title={t(item.descKey)}
            aria-label={`${item.token}: ${t(item.descKey)}`}
            className="kh-ops-type-chip disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => props.onInsert(item.token)}
          >
            {item.token}
          </button>
        ))}
      </div>
      <p className="m-0 text-[0.7rem] leading-snug text-ink-muted">
        {t('templatesAvailableTokensHelp')}
      </p>
    </div>
  );
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
  hasDocxTemplate: boolean;
  docxTemplateContentType: string | null;
  docxTemplateBodyAnchor: string | null;
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
  const locale = useLocale();
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
  const [docxTemplateFile, setDocxTemplateFile] = useState<File | null>(null);

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

  const tokenSamples = useMemo(
    () => ({
      title: t('templatesTitleSample'),
      date: t('templatesDateSample'),
      datetime: t('templatesDatetimeSample'),
      slug: t('templatesSlugSample'),
      type: t('templatesTypeSample'),
      status: t('templatesStatusSample'),
    }),
    [t],
  );

  function startCreate() {
    setSelectedId(CREATE_ID);
    setForm(emptyForm);
    setLogoFile(null);
    setDocxTemplateFile(null);
    setError(null);
  }

  function loadPackIntoForm(pack: PublicStylePack) {
    setSelectedId(pack.id);
    setLogoFile(null);
    setDocxTemplateFile(null);
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

  async function uploadDocxTemplate() {
    if (!selected || selected.builtin || !docxTemplateFile) {
      return;
    }
    const maxBytes = 15 * 1024 * 1024;
    if (docxTemplateFile.size === 0) {
      setError(t('templatesDocxEmpty'));
      return;
    }
    if (docxTemplateFile.size > maxBytes) {
      setError(t('templatesDocxTooLarge', { maxMb: 15 }));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', docxTemplateFile, docxTemplateFile.name);
      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}/docx-template`,
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
            t('templatesDocxFailed'),
        );
      }
      pushToast(t('templatesDocxUploaded'));
      setDocxTemplateFile(null);
      await refresh();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templatesDocxFailed'));
    } finally {
      setPending(false);
    }
  }

  async function removeDocxTemplate() {
    if (!selected || selected.builtin || !selected.hasDocxTemplate) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/admin/doc-factory/style-packs/${selected.id}/docx-template`,
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
            t('templatesDocxRemoveFailed'),
        );
      }
      pushToast(t('templatesDocxRemoved'));
      await refresh();
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('templatesDocxRemoveFailed'),
      );
    } finally {
      setPending(false);
    }
  }

  async function downloadDocxStarter() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        '/api/v1/admin/doc-factory/style-packs/docx-template-starter',
        { credentials: 'include' },
      );
      if (!response.ok) {
        throw new Error(t('templatesDocxStarterFailed'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'pkh-style-pack-starter.docx';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('templatesDocxStarterFailed'),
      );
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
          body: JSON.stringify({ format, locale }),
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
    <div className="grid items-start gap-6">
      <section className="kh-ops-panel">
        <div className="kh-ops-panel-head">
          <p className="kh-ops-panel-title">{t('templatesList')}</p>
        </div>
        <ul className="kh-ops-project-grid m-0 list-none px-0">
          {packs.map((pack) => {
            const active = !isCreating && selectedId === pack.id;
            return (
              <li key={pack.id}>
                <button
                  type="button"
                  className={`kh-ops-project-card w-full text-left${
                    active ? ' selected' : ''
                  }`}
                  onClick={() => loadPackIntoForm(pack)}
                >
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
                  <h3>{pack.label}</h3>
                  <p>
                    {[
                      pack.typography.headingFont,
                      pack.typography.bodyFont,
                      pack.formats.join(' · '),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className="kh-ops-project-card-foot">
                    <span>{pack.slug}</span>
                    <span>{tCommon('edit')}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="kh-ops-panel">
        <div className="kh-ops-card-body grid gap-4">
        <p className="m-0 text-sm text-ink-muted">
          {isCreating
            ? t('templatesCreatingBlurb')
            : selected?.builtin
              ? t('templatesBlankReadOnly')
              : t('templatesEditorBlurb')}
        </p>
        {error ? <ErrorText>{error}</ErrorText> : null}

        <div className="kh-ops-form-grid">
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
              placeholder={t('templatesTokenHint')}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  headerText: event.target.value,
                }))
              }
            />
            <StylePackTokenHints
              disabled={fieldsDisabled}
              onInsert={(token) =>
                setForm((current) => ({
                  ...current,
                  headerText: `${current.headerText}${token}`,
                }))
              }
            />
            <p className="m-0 text-xs text-ink-muted">
              {t('templatesResolvesTo', {
                value:
                  form.headerText.trim().length > 0
                    ? previewStyleTemplate(form.headerText, tokenSamples)
                    : tCommon('emDash'),
              })}
            </p>
          </Field>
          <Field label={t('templatesFooterText')}>
            <Input
              value={form.footerText}
              disabled={fieldsDisabled}
              placeholder={t('templatesTokenHint')}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  footerText: event.target.value,
                }))
              }
            />
            <StylePackTokenHints
              disabled={fieldsDisabled}
              onInsert={(token) =>
                setForm((current) => ({
                  ...current,
                  footerText: `${current.footerText}${token}`,
                }))
              }
            />
            <p className="m-0 text-xs text-ink-muted">
              {t('templatesResolvesTo', {
                value:
                  form.footerText.trim().length > 0
                    ? previewStyleTemplate(form.footerText, tokenSamples)
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
            placeholder={t('templatesDisclaimerHint')}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                disclaimer: event.target.value,
              }))
            }
          />
          <StylePackTokenHints
            disabled={fieldsDisabled}
            onInsert={(token) =>
              setForm((current) => ({
                ...current,
                disclaimer: `${current.disclaimer}${token}`,
              }))
            }
          />
          <p className="m-0 text-xs text-ink-muted">
            {t('templatesResolvesTo', {
              value:
                form.disclaimer.trim().length > 0
                  ? previewStyleTemplate(form.disclaimer, tokenSamples)
                  : tCommon('emDash'),
            })}
          </p>
        </Field>

        <div className="kh-ops-scope-checks">
          <label className="kh-ops-scope-check">
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
          <label className="kh-ops-scope-check">
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
          <label className="kh-ops-scope-check">
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
          <label className="kh-ops-scope-check">
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
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label={t('templatesLogo')}>
                <FilePicker
                  accept="image/png,image/jpeg,image/webp"
                  fileName={logoFile?.name}
                  onFileChange={setLogoFile}
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
            <div className="kh-ops-inset grid gap-3">
              <p className="m-0 text-sm font-semibold text-ink">
                {t('templatesDocxShell')}
              </p>
              <p className="m-0 text-xs text-ink-muted">
                {t('templatesDocxShellBlurb')}
              </p>
              {selected.hasDocxTemplate ? (
                <p className="m-0 text-xs text-ink-muted">
                  {t('templatesDocxPresent', {
                    anchor: selected.docxTemplateBodyAnchor ?? '—',
                  })}
                </p>
              ) : (
                <p className="m-0 text-xs text-ink-muted">
                  {t('templatesDocxMissing')}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <Field label={t('templatesDocxFile')}>
                  <FilePicker
                    accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    fileName={docxTemplateFile?.name}
                    onFileChange={setDocxTemplateFile}
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending || !docxTemplateFile}
                  onClick={() => void uploadDocxTemplate()}
                >
                  {t('templatesUploadDocx')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void downloadDocxStarter()}
                >
                  {t('templatesDocxStarter')}
                </Button>
                {selected.hasDocxTemplate ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void removeDocxTemplate()}
                  >
                    {t('templatesRemoveDocx')}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="kh-ops-action-line">
          <div className="flex flex-wrap gap-2">
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
        </div>
        </div>
      </section>
    </div>
  );
}
