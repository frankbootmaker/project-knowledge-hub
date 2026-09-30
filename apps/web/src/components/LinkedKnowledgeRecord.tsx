'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

/** Real anchor to a knowledge record in the current workspace. */
export function LinkedKnowledgeRecord({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  const params = useParams();
  const workspaceSlug = typeof params.slug === 'string' ? params.slug : '';
  if (!workspaceSlug || !slug) {
    return <span>{title}</span>;
  }
  return (
    <Link
      href={`/workspaces/${workspaceSlug}/records/${slug}`}
      className="kh-ops-record-link"
    >
      {title}
    </Link>
  );
}
