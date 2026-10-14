import { EMPTY_FILTER_VALUE } from './data-table';

export type MediaFilterItem = {
  originalFilename: string | null;
  altText: string | null;
  contentType: string;
  createdByName: string | null;
  createdAt: string;
  usedBy: Array<{
    entityType: string;
    humanKey: string | null;
    title: string;
  }>;
};

export type MediaFilterQuery = {
  query: string;
  contentTypes: string[];
  linkStatus: string[];
  itemTypes: string[];
  uploaders: string[];
  createdFrom: string;
  createdTo: string;
};

export function mediaLocalDateKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mediaSearchText(item: MediaFilterItem): string {
  return [
    item.originalFilename,
    item.altText,
    item.contentType,
    item.createdByName,
    ...item.usedBy.flatMap((row) => [row.entityType, row.humanKey, row.title]),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .toLowerCase();
}

function chosen(values: string[]): boolean {
  return values.some((value) => value !== '');
}

export function mediaMatchesFilter(
  item: MediaFilterItem,
  filter: MediaFilterQuery,
): boolean {
  const needle = filter.query.trim().toLowerCase();
  if (needle && !mediaSearchText(item).includes(needle)) return false;

  if (chosen(filter.contentTypes) && !filter.contentTypes.includes(item.contentType)) {
    return false;
  }

  if (chosen(filter.linkStatus)) {
    const status = item.usedBy.length > 0 ? 'linked' : 'unlinked';
    if (!filter.linkStatus.includes(status)) return false;
  }

  if (chosen(filter.itemTypes)) {
    const types = new Set(item.usedBy.map((row) => row.entityType));
    if (!filter.itemTypes.some((value) => types.has(value))) return false;
  }

  if (chosen(filter.uploaders)) {
    const uploader = item.createdByName?.trim()
      ? item.createdByName
      : EMPTY_FILTER_VALUE;
    if (!filter.uploaders.includes(uploader)) return false;
  }

  const day = mediaLocalDateKey(item.createdAt);
  if (filter.createdFrom && (!day || day < filter.createdFrom)) return false;
  if (filter.createdTo && (!day || day > filter.createdTo)) return false;
  return true;
}
