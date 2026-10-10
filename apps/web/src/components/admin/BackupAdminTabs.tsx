import Link from 'next/link';

export const BACKUP_ADMIN_TABS = ['backups', 'storage'] as const;

export type BackupAdminTab = (typeof BACKUP_ADMIN_TABS)[number];

export function parseBackupAdminTab(value: string | string[] | undefined): BackupAdminTab {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'storage') return 'storage';
  return 'backups';
}

export function backupAdminTabHref(tab: BackupAdminTab): string {
  if (tab === 'backups') return '/admin/backups';
  return '/admin/backups?tab=storage';
}

export function BackupAdminTabs({
  active,
  label,
  labels,
}: {
  active: BackupAdminTab;
  label: string;
  labels: Record<BackupAdminTab, string>;
}) {
  return (
    <nav className="kh-ops-page-tabs" role="tablist" aria-label={label}>
      {BACKUP_ADMIN_TABS.map((tab) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            href={backupAdminTabHref(tab)}
            role="tab"
            aria-selected={selected}
            className={selected ? 'active' : undefined}
          >
            {labels[tab]}
          </Link>
        );
      })}
    </nav>
  );
}
