import { describe, expect, it, vi } from 'vitest';
import { ECB_EUROFX_90_URL, loadReferenceRates, parseEcbEuroFx, parseMnbRates } from './fx-feed.js';

const ECB = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube time="2026-10-16">
      <Cube currency="USD" rate="1.0856"/>
      <Cube currency="HUF" rate="395.12"/>
    </Cube>
    <Cube time="2026-10-15">
      <Cube currency="USD" rate="1.0800"/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const MNB = `<?xml version="1.0"?>
<soap:Envelope>
  <soap:Body>
    <GetExchangeRatesResponse>
      <GetExchangeRatesResult>&lt;MNBExchangeRates&gt;
        &lt;Day date="2026-10-16"&gt;
          &lt;Rate unit="1" curr="EUR"&gt;395,12&lt;/Rate&gt;
          &lt;Rate unit="1" curr="USD"&gt;364,50&lt;/Rate&gt;
        &lt;/Day&gt;
      &lt;/MNBExchangeRates&gt;</GetExchangeRatesResult>
    </GetExchangeRatesResponse>
  </soap:Body>
</soap:Envelope>`;

describe('parseEcbEuroFx', () => {
  it('reads euro reference quotes', () => {
    expect(parseEcbEuroFx(ECB)).toEqual([
      { date: '2026-10-16', base: 'EUR', quote: 'USD', rate: 1.0856, source: 'ecb' },
      { date: '2026-10-16', base: 'EUR', quote: 'HUF', rate: 395.12, source: 'ecb' },
      { date: '2026-10-15', base: 'EUR', quote: 'USD', rate: 1.08, source: 'ecb' },
    ]);
  });
});

describe('loadReferenceRates', () => {
  it('does not throw when the fetcher fails', async () => {
    const fetchImpl = vi.fn(async (_url: string) => {
      throw new Error('offline');
    });
    const result = await loadReferenceRates({
      fetchImpl,
      from: '2026-10-01',
      to: '2026-10-16',
      now: new Date('2026-10-16T00:00:00.000Z'),
    });
    expect(result.rates).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(fetchImpl).toHaveBeenCalled();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(ECB_EUROFX_90_URL);
  });

  it('keeps ECB quotes when MNB fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('ecb.europa.eu')) {
        return { ok: true, status: 200, text: async () => ECB };
      }
      throw new Error('mnb down');
    });
    const result = await loadReferenceRates({
      fetchImpl,
      from: '2026-10-16',
      to: '2026-10-16',
    });
    expect(result.rates.map((rate) => rate.quote).sort()).toEqual(['HUF', 'USD']);
    expect(result.errors.join(' ')).toContain('mnb down');
  });
});

describe('parseMnbRates', () => {
  it('reads HUF per foreign unit from an escaped SOAP body', () => {
    expect(parseMnbRates(MNB)).toEqual([
      { date: '2026-10-16', base: 'EUR', quote: 'HUF', rate: 395.12, source: 'mnb' },
      { date: '2026-10-16', base: 'USD', quote: 'HUF', rate: 364.5, source: 'mnb' },
    ]);
  });
});
