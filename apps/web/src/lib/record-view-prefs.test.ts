/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  readRelatedEntriesOpen,
  relatedEntriesOpenStorageKey,
  writeRelatedEntriesOpen,
} from './record-view-prefs';

beforeEach(() => {
  localStorage.clear();
});

describe('record-view-prefs', () => {
  it('defaults related entries to collapsed', () => {
    expect(readRelatedEntriesOpen()).toBe(false);
  });

  it('persists related entries open state', () => {
    writeRelatedEntriesOpen(true);
    expect(localStorage.getItem(relatedEntriesOpenStorageKey)).toBe('1');
    expect(readRelatedEntriesOpen()).toBe(true);
    writeRelatedEntriesOpen(false);
    expect(readRelatedEntriesOpen()).toBe(false);
  });
});
