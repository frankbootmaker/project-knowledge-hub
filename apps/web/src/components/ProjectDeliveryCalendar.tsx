'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button } from './ui';
import { cn } from '../lib/cn';
import {
  deliveryScheduleSurfaceClass,
  deliveryScheduleTone,
  todayYmd,
} from '../lib/delivery-schedule';
import { DeliveryScheduleLegend } from './DeliveryScheduleLegend';

export type CalendarItem = {
  id: string;
  kind: 'task' | 'milestone';
  title: string;
  date: string;
  status: string;
};

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Monday-based offset for the 1st of the month (0 = Monday). */
function mondayOffset(year: number, monthIndex: number): number {
  const weekday = new Date(year, monthIndex, 1).getDay(); // 0 = Sunday
  return (weekday + 6) % 7;
}

export function ProjectDeliveryCalendar({
  items,
}: {
  items: CalendarItem[];
}) {
  const t = useTranslations('delivery');
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    setCursor({ year: now.getFullYear(), month: now.getMonth() });
    setToday(todayYmd(now));
  }, []);

  const cells = useMemo(() => {
    if (!cursor) return [];
    const { year, month } = cursor;
    const totalDays = daysInMonth(year, month);
    const offset = mondayOffset(year, month);
    const byDate = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const list = byDate.get(item.date) ?? [];
      list.push(item);
      byDate.set(item.date, list);
    }

    const result: Array<{
      key: string;
      day: number | null;
      iso: string | null;
      items: CalendarItem[];
      inMonth: boolean;
    }> = [];

    for (let i = 0; i < offset; i += 1) {
      result.push({ key: `pad-${i}`, day: null, iso: null, items: [], inMonth: false });
    }
    for (let day = 1; day <= totalDays; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      result.push({
        key: iso,
        day,
        iso,
        items: byDate.get(iso) ?? [],
        inMonth: true,
      });
    }
    while (result.length % 7 !== 0) {
      result.push({
        key: `tail-${result.length}`,
        day: null,
        iso: null,
        items: [],
        inMonth: false,
      });
    }
    return result;
  }, [cursor, items]);

  if (!cursor || !today) {
    return (
      <div className="rounded-lg border border-line px-4 py-10 text-center text-sm text-ink-muted">
        {t('calendarLoading')}
      </div>
    );
  }

  const monthLabel = t('calendarMonthLabel', {
    month: t(`calendarMonths.${cursor.month}`),
    year: cursor.year,
  });

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-base font-semibold">{monthLabel}</h3>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCursor((prev) => {
                if (!prev) return prev;
                const date = new Date(prev.year, prev.month - 1, 1);
                return { year: date.getFullYear(), month: date.getMonth() };
              })
            }
          >
            {t('calendarPrev')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const now = new Date();
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setToday(todayYmd(now));
            }}
          >
            {t('calendarToday')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCursor((prev) => {
                if (!prev) return prev;
                const date = new Date(prev.year, prev.month + 1, 1);
                return { year: date.getFullYear(), month: date.getMonth() };
              })
            }
          >
            {t('calendarNext')}
          </Button>
        </div>
      </div>

      <DeliveryScheduleLegend />

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {WEEKDAY_KEYS.map((key) => (
          <div
            key={key}
            className="bg-panel px-2 py-2 text-center text-xs font-semibold tracking-wide text-ink-muted uppercase"
          >
            {t(`calendarWeekdays.${key}`)}
          </div>
        ))}
        {cells.map((cell) => (
          <div
            key={cell.key}
            className={cn(
              'min-h-[7.5rem] bg-panel-solid p-2',
              !cell.inMonth && 'bg-neutral-soft/50',
            )}
          >
            {cell.day != null ? (
              <p className="m-0 mb-1 text-xs font-semibold text-ink-muted">{cell.day}</p>
            ) : null}
            <ul className="m-0 grid list-none gap-1 p-0">
              {cell.items.slice(0, 4).map((item) => {
                const tone = deliveryScheduleTone({
                  status: item.status,
                  date: item.date,
                  today,
                });
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'truncate rounded border px-1.5 py-1 text-xs',
                      deliveryScheduleSurfaceClass(tone),
                    )}
                    title={`${item.title} — ${t(`scheduleTone.${tone}`)}`}
                  >
                    <Badge
                      tone={item.kind === 'milestone' ? 'brand' : 'neutral'}
                      className="mr-1"
                    >
                      {item.kind === 'milestone' ? 'M' : 'T'}
                    </Badge>
                    <span className="text-ink">{item.title}</span>
                  </li>
                );
              })}
              {cell.items.length > 4 ? (
                <li className="text-xs text-ink-muted">
                  {t('calendarMore', { count: cell.items.length - 4 })}
                </li>
              ) : null}
            </ul>
          </div>
        ))}
      </div>
      <p className="m-0 text-xs text-ink-muted">{t('calendarHint')}</p>
    </div>
  );
}
