export const relatedEntriesOpenStorageKey = 'kh-record-related-entries-open';

export function readRelatedEntriesOpen(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(relatedEntriesOpenStorageKey) === '1';
  } catch {
    return false;
  }
}

export function writeRelatedEntriesOpen(open: boolean): void {
  try {
    localStorage.setItem(relatedEntriesOpenStorageKey, open ? '1' : '0');
  } catch {
    // Ignore quota / private mode.
  }
}
