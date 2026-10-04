'use client';

import { useTranslations } from 'next-intl';
import { buttonClassName } from './ui';
import { cn } from '../lib/cn';
import {
  PROJECT_SECTIONS,
  isHeaderShortcutActive,
  type ProjectSectionStatusValue,
  type ProjectSectionStatuses,
} from '../lib/project-sections';
import { useFollowProjectAnchor } from './ops/followProjectAnchor';
import { useProjectRail } from './ops/ProjectRailContext';

function ragNavClass(rag: ProjectSectionStatusValue | null): string {
  if (rag === 'red' || rag === 'amber' || rag === 'green' || rag === 'none') {
    return 'kh-section-status';
  }
  return '';
}

/** Header shortcuts generated from the shared project section list. */
export function ProjectShortcutNav({ statuses }: { statuses: ProjectSectionStatuses }) {
  const tNav = useTranslations('nav');
  const tProject = useTranslations('projects');
  const { activeAnchor } = useProjectRail();
  const followProjectAnchor = useFollowProjectAnchor();

  return (
    <nav aria-label={tProject('sectionNav')} className="flex flex-wrap items-center gap-2">
      {PROJECT_SECTIONS.map((section) => {
        const rag = section.statusSource ? (statuses[section.statusSource] ?? null) : null;
        const label = tNav(section.labelKey);
        const status = rag ? tProject(`rag.${rag}`) : null;
        const accessible = status ? `${label}: ${status}` : label;
        const current = isHeaderShortcutActive(section.anchor, activeAnchor);
        return (
          <a
            key={section.id}
            href={`#${section.anchor}`}
            className={cn(
              buttonClassName('secondary', '!px-2.5 !py-1 text-xs'),
              'kh-section-shortcut',
              ragNavClass(rag),
            )}
            data-rag={rag ?? undefined}
            title={status ? accessible : undefined}
            aria-label={accessible}
            aria-current={current ? 'location' : undefined}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              followProjectAnchor(`#${section.anchor}`, event);
            }}
          >
            {label}
            {rag === 'none' && status ? <span className="font-semibold">{status}</span> : null}
          </a>
        );
      })}
    </nav>
  );
}
