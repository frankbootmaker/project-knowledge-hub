import { describe, expect, it } from 'vitest';
import {
  exportChromeCopy,
  labelLifecycleStatus,
  labelRecordType,
  normalizeExportLocale,
} from './export-labels.js';

describe('export-labels', () => {
  it('normalizes locale codes', () => {
    expect(normalizeExportLocale('hu')).toBe('hu');
    expect(normalizeExportLocale('HU')).toBe('hu');
    expect(normalizeExportLocale('de-DE')).toBe('de');
    expect(normalizeExportLocale('xx')).toBe('en');
  });

  it('translates lifecycle status and record type', () => {
    expect(labelLifecycleStatus('current', 'hu')).toBe('Aktuális');
    expect(labelLifecycleStatus('current', 'de')).toBe('Aktuell');
    expect(labelLifecycleStatus('current', 'en')).toBe('Current');
    expect(labelRecordType('inventory', 'hu')).toBe('Leltár');
    expect(labelRecordType('note', 'de')).toBe('Notiz');
  });

  it('localizes the exported chrome prefix', () => {
    expect(exportChromeCopy('en').exported).toBe('Exported');
    expect(exportChromeCopy('de').exported).toBe('Exportiert');
    expect(exportChromeCopy('hu').exported).toBe('Exportálva');
  });
});
