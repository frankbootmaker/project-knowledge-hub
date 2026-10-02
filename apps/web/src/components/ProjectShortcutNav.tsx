import { getTranslations } from 'next-intl/server';
import { buttonClassName } from './ui';
import { cn } from '../lib/cn';
import {
  PROJECT_SECTIONS,
  type ProjectSectionStatusValue,
  type ProjectSectionStatuses,
} from '../lib/project-sections';

function ragNavClass(rag: ProjectSectionStatusValue | null): string {
  if (rag === 'red' || rag === 'amber' || rag === 'green' || rag === 'none') {
    return 'kh-section-status';
  }
  return '';
}

/** Header shortcuts generated from the shared project section list. */
export async function ProjectShortcutNav({ statuses }: { statuses: ProjectSectionStatuses }) {
  const tNav = await getTranslations('nav');
  const tProject = await getTranslations('projects');

  return (
    <nav aria-label={tProject('sectionNav')} className="flex flex-wrap items-center gap-2">
      {PROJECT_SECTIONS.map((section) => {
        const rag = section.statusSource ? (statuses[section.statusSource] ?? null) : null;
        const label = tNav(section.labelKey);
        const status = rag ? tProject(`rag.${rag}`) : null;
        const accessible = status ? `${label}: ${status}` : label;
        return (
          <a
            key={section.id}
            href={`#${section.anchor}`}
            className={cn(buttonClassName('secondary', '!px-2.5 !py-1 text-xs'), ragNavClass(rag))}
            data-rag={rag ?? undefined}
            title={status ? accessible : undefined}
            aria-label={accessible}
          >
            {label}
            {rag === 'none' && status ? <span className="font-semibold">{status}</span> : null}
          </a>
        );
      })}
    </nav>
  );
}
