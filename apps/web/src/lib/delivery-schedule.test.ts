import { describe, expect, it } from 'vitest';
import { deliveryScheduleTone, projectDeliveryRag } from './delivery-schedule';

const TODAY = '2026-10-17';

describe('project timeline RAG vs card tone', () => {
  it('keeps the 3-day card tone and the 7-day project RAG', () => {
    const dueInFiveDays = { status: 'todo', date: '2026-10-22' };
    expect(
      deliveryScheduleTone({ ...dueInFiveDays, today: TODAY }),
    ).toBe('onTrack');
    expect(projectDeliveryRag([dueInFiveDays], TODAY)).toBe('amber');
  });

  it('still marks a card due in 3 days at risk', () => {
    expect(
      deliveryScheduleTone({
        status: 'todo',
        date: '2026-10-20',
        today: TODAY,
      }),
    ).toBe('atRisk');
  });
});
