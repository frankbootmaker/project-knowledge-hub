'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, raidSeverityTone } from './ui';

type LinkedRaid = {
  id: string;
  title: string;
  kind: string;
  severity: string;
  humanKey: string | null;
  projectSlug: string;
};

export function KnowledgeRecordRaidLinks({ recordId }: { recordId: string }) {
  const t = useTranslations('raid');
  const params = useParams();
  const workspaceSlug = typeof params.slug === 'string' ? params.slug : '';
  const [items, setItems] = useState<LinkedRaid[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/v1/knowledge-records/${recordId}/raid-items`)
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = (await response.json()) as { raidItems?: LinkedRaid[] };
        return payload.raidItems ?? [];
      })
      .then((raidItems) => {
        if (!cancelled) setItems(raidItems);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  return (
    <div className="kh-ops-field-span">
      <p className="mt-0 mb-2 text-sm font-semibold">{t('linkedRaidOnRecord')}</p>
      {items.length === 0 ? (
        <p className="m-0 text-sm text-ink-muted">{t('linkedRaidOnRecordEmpty')}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {items.map((item) => {
            const label = `${item.humanKey ? `${item.humanKey} · ` : ''}${item.title}`;
            const badge = (
              <Badge tone={raidSeverityTone(item.severity)}>{label}</Badge>
            );
            if (!workspaceSlug || !item.projectSlug) return (
              <span key={item.id}>{badge}</span>
            );
            return (
              <Link
                key={item.id}
                href={`/workspaces/${workspaceSlug}/projects/${item.projectSlug}?raid=${item.id}#project-raid`}
                className="kh-ops-record-link"
              >
                {badge}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
