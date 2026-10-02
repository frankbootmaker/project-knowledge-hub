import { getTranslations } from 'next-intl/server';
import { buttonClassName } from './ui';
import { cn } from '../lib/cn';
import type { ProjectRagStatus } from '../lib/delivery-schedule';
import { PROJECT_SECTIONS, type ProjectSectionStatuses } from '../lib/project-sections';

function ragNavClass(rag: ProjectRagStatus | null): string {
  if (rag === 'red') {
    return 'border-danger/35 bg-danger-soft text-danger hover:bg-danger-soft';
  }
  if (rag === 'amber') {
    return 'border-warn/40 bg-warn-soft text-warn hover:bg-warn-soft';
  }
  if (rag === 'green') {
    return 'border-accent/35 bg-accent-soft text-accent hover:bg-accent-soft';
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
            title={status ? accessible : undefined}
            aria-label={accessible}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
