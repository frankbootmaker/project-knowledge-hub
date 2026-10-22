import { describe, expect, it } from 'vitest';
import {
  FINANCIALS_TABS,
  financialsTabHref,
  parseFinancialsTab,
} from './FinancialsTabs';

describe('financials tabs', () => {
  it('starts with AI Cost and keeps unknown tabs on that default', () => {
    expect(FINANCIALS_TABS).toEqual(['ai-cost', 'usage-import', 'model-rates']);
    expect(parseFinancialsTab(undefined)).toBe('ai-cost');
    expect(parseFinancialsTab('usage-import')).toBe('usage-import');
    expect(parseFinancialsTab('model-rates')).toBe('model-rates');
    expect(parseFinancialsTab('nope')).toBe('ai-cost');
    expect(parseFinancialsTab(['ai-cost'])).toBe('ai-cost');
  });

  it('omits the query for the default tab', () => {
    expect(financialsTabHref('platform', 'ai-cost')).toBe('/workspaces/platform/financials');
    expect(financialsTabHref('platform', 'usage-import')).toBe(
      '/workspaces/platform/financials?tab=usage-import',
    );
    expect(financialsTabHref('platform', 'model-rates')).toBe(
      '/workspaces/platform/financials?tab=model-rates',
    );
  });
});
