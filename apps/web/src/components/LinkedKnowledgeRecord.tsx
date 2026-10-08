'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { recordHref } from '../lib/record-href';

/** Real anchor to a knowledge record, nested when opened inside a project. */
export function LinkedKnowledgeRecord({ slug, title }: { slug: string; title: string }) {
  const params = useParams();
  const workspaceSlug = typeof params.slug === 'string' ? params.slug : '';
  const projectSlug = typeof params.projectSlug === 'string' ? params.projectSlug : undefined;
  if (!workspaceSlug || !slug) {
    return <span>{title}</span>;
  }
  return (
    <Link
      href={recordHref({ workspaceSlug, projectSlug, recordSlug: slug })}
      className="kh-ops-record-link"
    >
      {title}
    </Link>
  );
}
