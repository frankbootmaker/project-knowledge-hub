import { describe, expect, it } from 'vitest';
import {
  PLATFORM_FINANCIALS_TABS,
  parsePlatformFinancialsTab,
  platformFinancialsTabHref,
} from './PlatformFinancialsTabs';

describe('platform financials tabs', () => {
  it('starts with AI Cost and keeps unknown tabs on that default', () => {
    expect(PLATFORM_FINANCIALS_TABS[0]).toBe('ai-cost');
    expect(parsePlatformFinancialsTab(undefined)).toBe('ai-cost');
    expect(parsePlatformFinancialsTab('usage-import')).toBe('ai-cost');
    expect(parsePlatformFinancialsTab(['ai-cost'])).toBe('ai-cost');
  });

  it('omits the query for the default tab', () => {
    expect(platformFinancialsTabHref('ai-cost')).toBe('/admin/financials');
  });
});
