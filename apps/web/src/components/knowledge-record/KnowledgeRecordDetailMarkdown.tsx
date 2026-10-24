'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MarkdownDocument } from '../MarkdownDocument';
import {
  countRelatedEntries,
  KnowledgeRecordRelationsPanel,
  type KnowledgeRecordRelationsPayload,
} from './KnowledgeRecordRelationsPanel';
import {
  readRelatedEntriesOpen,
  writeRelatedEntriesOpen,
} from '../../lib/record-view-prefs';

type CatalogueRecord = {
  id: string;
  title: string;
  slug: string;
  humanKey?: string | null;
  recordType: string;
  lifecycleStatus: string;
  projectId: string | null;
  archivedAt: string | null;
};

export function KnowledgeRecordDetailMarkdown({
  html,
  toc,
  title,
  recordId,
  projectId,
  canEditRelations,
  relations,
  catalogue,
}: {
  html: string;
  toc: Array<{ id: string; text: string; depth: number }>;
  title: string;
  recordId: string;
  projectId: string | null;
  canEditRelations: boolean;
  relations: KnowledgeRecordRelationsPayload | null;
  catalogue: CatalogueRecord[];
}) {
  const relatedCount = countRelatedEntries(relations);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [addRelationButton, setAddRelationButton] = useState<ReactNode>(null);

  useEffect(() => {
    setRelatedOpen(readRelatedEntriesOpen());
  }, []);

  const supplyAddButton = useCallback((button: ReactNode) => {
    setAddRelationButton(button);
  }, []);

  function onRelatedOpenChange(open: boolean) {
    setRelatedOpen(open);
    writeRelatedEntriesOpen(open);
  }

  return (
    <MarkdownDocument
      html={html}
      toc={toc}
      title={title}
      relatedEntries={
        relatedCount > 0
          ? {
              count: relatedCount,
              open: relatedOpen,
              onOpenChange: onRelatedOpenChange,
              toolbarTrailing: addRelationButton,
              panel: (
                <KnowledgeRecordRelationsPanel
                  recordId={recordId}
                  projectId={projectId}
                  canEdit={canEditRelations}
                  initial={relations}
                  catalogue={catalogue}
                  embedded
                  supplyAddButton={supplyAddButton}
                />
              ),
            }
          : undefined
      }
    />
  );
}
