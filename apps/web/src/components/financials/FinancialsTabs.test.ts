import { describe, expect, it } from 'vitest';
import {
  FINANCIALS_TABS,
  financialsTabHref,
  parseFinancialsTab,
} from './FinancialsTabs';

describe('financials tabs', () => {
  it('starts with AI Cost and keeps unknown tabs on that default', () => {
    expect(FINANCIALS_TABS[0]).toBe('ai-cost');
    expect(parseFinancialsTab(undefined)).toBe('ai-cost');
    expect(parseFinancialsTab('usage-import')).toBe('ai-cost');
    expect(parseFinancialsTab(['ai-cost'])).toBe('ai-cost');
  });

  it('omits the query for the default tab', () => {
    expect(financialsTabHref('platform', 'ai-cost')).toBe('/workspaces/platform/financials');
  });
});
