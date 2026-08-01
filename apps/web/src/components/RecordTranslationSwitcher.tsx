import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { localeLabels, locales, type AppLocale } from '../i18n/config';

export type TranslationSibling = {
  id: string;
  slug: string;
  language: string | null;
  title: string;
  lifecycleStatus: string;
};

function languageLabel(code: string | null | undefined): string {
  const normalized = (code ?? 'en').toLowerCase();
  if (locales.includes(normalized as AppLocale)) {
    return localeLabels[normalized as AppLocale];
  }
  return normalized.toUpperCase();
}

/** Server-rendered language chips for translation siblings (2+ members). */
export async function RecordTranslationSwitcher({
  workspaceSlug,
  currentRecordId,
  translations,
}: {
  workspaceSlug: string;
  currentRecordId: string;
  translations: TranslationSibling[];
}) {
  const t = await getTranslations('records');
  if (translations.length < 2) {
    return null;
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink-muted">{t('translationsLabel')}</span>
      {translations.map((item) => {
        const code = item.language ?? 'en';
        const active = item.id === currentRecordId;
        const label = languageLabel(code);
        if (active) {
          return (
            <span
              key={item.id}
              className="inline-flex items-center rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1 text-sm font-medium text-brand"
              aria-current="page"
            >
              {label} ({code})
            </span>
          );
        }
        return (
          <Link
            key={item.id}
            href={`/workspaces/${workspaceSlug}/records/${item.slug}`}
            className="inline-flex items-center rounded-md border border-line bg-panel-solid px-2.5 py-1 text-sm text-ink no-underline transition hover:border-brand/35"
            title={item.title}
          >
            {label} ({code})
          </Link>
        );
      })}
    </div>
  );
}
