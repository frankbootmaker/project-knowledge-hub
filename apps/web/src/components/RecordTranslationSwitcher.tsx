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
    <section className="kh-ops-panel">
      <div className="kh-ops-panel-head">
        <h2 className="kh-ops-panel-title">{t('translationsLabel')}</h2>
      </div>
      <div className="kh-ops-card-body">
        {translations.map((item) => {
          const code = item.language ?? 'en';
          const active = item.id === currentRecordId;
          const label = languageLabel(code);
          if (active) {
            return (
              <span
                key={item.id}
                className="kh-ops-lang-chip"
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
              className="kh-ops-lang-chip"
              title={item.title}
            >
              {label} ({code})
            </Link>
          );
        })}
      </div>
    </section>
  );
}
