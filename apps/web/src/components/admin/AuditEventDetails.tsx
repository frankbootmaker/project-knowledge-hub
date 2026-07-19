'use client';

import { useTranslations } from 'next-intl';

export function AuditEventDetails({ metadata }: { metadata: unknown }) {
  const t = useTranslations('admin');

  if (metadata == null || (typeof metadata === 'object' && Object.keys(metadata).length === 0)) {
    return null;
  }

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-sm font-medium text-ink-muted hover:text-ink">
        {t('auditMetadata')}
      </summary>
      <pre className="mt-2 overflow-x-auto rounded-md bg-panel-solid px-3 py-2 font-mono text-xs text-ink-muted">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  );
}
