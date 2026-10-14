import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER_VALUE } from './data-table';
import {
  mediaLocalDateKey,
  mediaMatchesFilter,
  type MediaFilterItem,
} from './media-library-filter';

const linked: MediaFilterItem = {
  originalFilename: 'rack.png',
  altText: 'Rack diagram',
  contentType: 'image/png',
  createdByName: 'Administrator',
  createdAt: '2026-10-14T21:09:57.595Z',
  usedBy: [
    {
      entityType: 'task',
      humanKey: 'HL1-T-1',
      title: 'Document Traefik route',
    },
    {
      entityType: 'epic',
      humanKey: 'HL1-E-1',
      title: 'Make Homelab operable',
    },
  ],
};

const spare: MediaFilterItem = {
  originalFilename: 'diagram.png',
  altText: null,
  contentType: 'image/jpeg',
  createdByName: null,
  createdAt: '2026-09-01T12:00:00.000Z',
  usedBy: [],
};

const open = {
  query: '',
  contentTypes: [],
  linkStatus: [],
  itemTypes: [],
  uploaders: [],
  createdFrom: '',
  createdTo: '',
};

describe('mediaMatchesFilter', () => {
  it('matches a name, key, or uploader search', () => {
    expect(mediaMatchesFilter(linked, { ...open, query: 'rack' })).toBe(true);
    expect(mediaMatchesFilter(linked, { ...open, query: 'hl1-t-1' })).toBe(true);
    expect(mediaMatchesFilter(linked, { ...open, query: 'administrator' })).toBe(true);
    expect(mediaMatchesFilter(spare, { ...open, query: 'traefik' })).toBe(false);
  });

  it('filters type, link status, item type, and uploader', () => {
    expect(
      mediaMatchesFilter(linked, { ...open, contentTypes: ['image/png'] }),
    ).toBe(true);
    expect(
      mediaMatchesFilter(spare, { ...open, contentTypes: ['image/png'] }),
    ).toBe(false);
    expect(
      mediaMatchesFilter(linked, { ...open, linkStatus: ['unlinked'] }),
    ).toBe(false);
    expect(
      mediaMatchesFilter(spare, { ...open, linkStatus: ['unlinked'] }),
    ).toBe(true);
    expect(
      mediaMatchesFilter(linked, { ...open, itemTypes: ['epic'] }),
    ).toBe(true);
    expect(
      mediaMatchesFilter(spare, { ...open, itemTypes: ['task'] }),
    ).toBe(false);
    expect(
      mediaMatchesFilter(spare, {
        ...open,
        uploaders: [EMPTY_FILTER_VALUE],
      }),
    ).toBe(true);
    expect(
      mediaMatchesFilter(linked, {
        ...open,
        uploaders: [EMPTY_FILTER_VALUE],
      }),
    ).toBe(false);
  });

  it('keeps an inclusive created-date range', () => {
    const linkedDay = mediaLocalDateKey(linked.createdAt);
    const spareDay = mediaLocalDateKey(spare.createdAt);
    expect(
      mediaMatchesFilter(linked, {
        ...open,
        createdFrom: linkedDay,
        createdTo: linkedDay,
      }),
    ).toBe(true);
    expect(
      mediaMatchesFilter(spare, { ...open, createdFrom: linkedDay }),
    ).toBe(spareDay >= linkedDay);
    expect(
      mediaMatchesFilter(linked, { ...open, createdTo: '2000-01-01' }),
    ).toBe(false);
  });
});