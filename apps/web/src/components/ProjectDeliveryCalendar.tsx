'use client';

import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { deliveryScheduleTone, todayYmd } from '../lib/delivery-schedule';
import { DeliveryScheduleLegend } from './DeliveryScheduleLegend';
import { downloadAuthenticatedExport } from '../lib/download-export';
import { UserAvatar } from './UserAvatar';
import { workItemIdLabel } from '../lib/work-item-label';
import { WorkItemIdLine } from './WorkItemIdLine';

export type CalendarItem = {
  id: string;
  kind: 'task' | 'milestone' | 'epic' | 'story';
  title: string;
  date: string;
  status: string;
  humanKey?: string | null;
  itemType?: 'task' | 'bug';
  owner?: {
    displayName: string;
    avatarUrl?: string | null;
  } | null;
};

export type CalendarExportHandle = {
  exportPdf: () => void;
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

function weekdayKeyForIso(iso: string): (typeof WEEKDAY_KEYS)[number] {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const weekday = new Date(year, month - 1, day).getDay();
  return WEEKDAY_KEYS[(weekday + 6) % 7]!;
}

function CalendarItemChip({
  item,
  today,
  dense,
  onOpen,
}: {
  item: CalendarItem;
  today: string;
  dense?: boolean;
  onOpen?: () => void;
}) {
  const t = useTranslations('delivery');
  const tone = deliveryScheduleTone({
    status: item.status,
    date: item.date,
    today,
  });
  const idLabel =
    item.kind === 'task'
      ? workItemIdLabel({
          itemType: item.itemType,
          humanKey: item.humanKey,
          taskLabel: '',
          bugLabel: t('kindBug'),
        })
      : (item.humanKey ?? '');
  const badgeLetter =
    item.kind === 'milestone'
      ? 'M'
      : item.kind === 'epic'
        ? 'E'
        : item.kind === 'story'
          ? 'S'
          : item.itemType === 'bug'
            ? 'B'
            : 'T';

  const entryTitle = `${idLabel ? `${idLabel} · ` : ''}${item.title} — ${t(`scheduleTone.${tone}`)}`;

  if (dense) {
    if (!onOpen) {
      return (
        <span className="kh-ops-event-dot" data-tone={tone} title={entryTitle}>
          {item.title}
        </span>
      );
    }
    return (
      <button
        type="button"
        className="kh-ops-event-dot"
        data-tone={tone}
        title={entryTitle}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {item.title}
      </button>
    );
  }

  return (
    <li className="kh-ops-data-item" title={entryTitle}>
      <div className="flex min-w-0 items-center gap-1.5">
        {item.owner ? (
          <UserAvatar
            displayName={item.owner.displayName}
            avatarUrl={item.owner.avatarUrl}
            size="xs"
          />
        ) : (
          <Badge tone={item.kind === 'milestone' ? 'brand' : 'neutral'} className="shrink-0">
            {badgeLetter}
          </Badge>
        )}
        <span className="min-w-0 truncate font-medium text-ink">{item.title}</span>
      </div>
      {item.kind === 'task' || item.humanKey ? (
        <span className="mt-0.5 block max-w-full">
          <WorkItemIdLine
            itemType={item.kind === 'task' ? item.itemType : undefined}
            humanKey={item.humanKey}
            bugLabel={item.kind === 'task' ? t('kindBug') : undefined}
            milestoneLabel={item.kind === 'milestone' ? '' : undefined}
            onHumanKeyOpen={onOpen}
          />
        </span>
      ) : null}
      <span className="kh-ops-menu-type mt-1 block text-ink-muted">
        {t(`scheduleTone.${tone}`)}
      </span>
    </li>
  );
}

export function ProjectDeliveryCalendar({
  projectId,
  projectName,
  items,
  exportHandleRef,
  onExportStateChange,
  onOpenItem,
  initialCursor,
  initialToday,
}: {
  projectId: string;
  projectName: string;
  items: CalendarItem[];
  exportHandleRef?: RefObject<CalendarExportHandle | null>;
  onExportStateChange?: (state: { pending: boolean; canExport: boolean } | null) => void;
  onOpenItem?: (item: CalendarItem) => void;
  /** Skip the post-hydration clock when the month is already known. */
  initialCursor?: { year: number; month: number };
  initialToday?: string;
}) {
  const t = useTranslations('delivery');
  const tProjects = useTranslations('projects');
  const { pushToast } = useToast();
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(
    initialCursor ?? null,
  );
  const [today, setToday] = useState<string | null>(initialToday ?? null);
  const [selectedIso, setSelectedIso] = useState<string | null>(initialToday ?? null);
  const [exportPending, setExportPending] = useState(false);

  useEffect(() => {
    const now = new Date();
    const iso = todayYmd(now);
    setCursor((current) => current ?? { year: now.getFullYear(), month: now.getMonth() });
    setToday((current) => current ?? iso);
    setSelectedIso((current) => current ?? iso);
  }, []);

  const exportCalendarPdf = useCallback(async () => {
    if (exportPending || !cursor || !today) return;
    setExportPending(true);
    try {
      const monthName = t(`calendarMonths.${cursor.month}`);
      const monthLabel = t('calendarMonthLabel', {
        month: monthName,
        year: cursor.year,
      });
      const title = t('calendarExportTitle', { project: projectName });
      const slug = projectName.replace(/[^\w.-]+/g, '-').toLowerCase();
      await downloadAuthenticatedExport(
        `/api/v1/projects/${projectId}/calendar/export`,
        `${slug}-calendar.pdf`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: window.location.origin,
          },
          body: JSON.stringify({
            title,
            year: cursor.year,
            monthIndex: cursor.month,
            today,
            labels: {
              generated: tProjects('reportGenerated'),
              empty: t('calendarAgendaEmpty'),
              more: t('calendarMore', { count: '{count}' }),
              milestone: t('kindMilestone'),
              task: t('kindTask'),
              weekdays: {
                mon: t('calendarWeekdaysShort.mon'),
                tue: t('calendarWeekdaysShort.tue'),
                wed: t('calendarWeekdaysShort.wed'),
                thu: t('calendarWeekdaysShort.thu'),
                fri: t('calendarWeekdaysShort.fri'),
                sat: t('calendarWeekdaysShort.sat'),
                sun: t('calendarWeekdaysShort.sun'),
              },
              monthLabel,
            },
          }),
        },
      );
      pushToast(t('calendarExported'));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t('calendarExportFailed'), 'danger');
    } finally {
      setExportPending(false);
    }
  }, [cursor, exportPending, projectId, projectName, pushToast, t, tProjects, today]);

  useEffect(() => {
    if (exportHandleRef) {
      exportHandleRef.current = {
        exportPdf: () => {
          void exportCalendarPdf();
        },
      };
    }
    onExportStateChange?.({
      pending: exportPending,
      canExport: Boolean(cursor && today),
    });
    return () => {
      if (exportHandleRef) exportHandleRef.current = null;
      onExportStateChange?.(null);
    };
  }, [cursor, exportCalendarPdf, exportHandleRef, exportPending, onExportStateChange, today]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const list = map.get(item.date) ?? [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => {
    if (!cursor) return [];
    const { year, month } = cursor;
    const totalDays = daysInMonth(year, month);
    const offset = mondayOffset(year, month);

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
  }, [cursor, byDate]);

  const selectedItems = selectedIso ? (byDate.get(selectedIso) ?? []) : [];
  const selectedDayNumber = selectedIso ? Number(selectedIso.slice(8, 10)) : null;

  const openCalendarItem = useCallback(
    (item: CalendarItem) => {
      onOpenItem?.(item);
    },
    [onOpenItem],
  );

  if (!cursor || !today) {
    return (
      <div className="kh-ops-empty-state kh-ops-panel">
        <div className="kh-ops-empty-mark">00</div>
        <h3>{t('calendarLoading')}</h3>
      </div>
    );
  }

  const monthLabel = t('calendarMonthLabel', {
    month: t(`calendarMonths.${cursor.month}`),
    year: cursor.year,
  });

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      if (!prev) return prev;
      const date = new Date(prev.year, prev.month + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() };
    });
  }

  return (
    <div className="grid gap-3">
      <div className="kh-ops-toolbar">
        <h3 className="m-0 font-display text-[13px] font-bold">{monthLabel}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => shiftMonth(-1)}>
            {t('calendarPrev')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const now = new Date();
              const iso = todayYmd(now);
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
              setToday(iso);
              setSelectedIso(iso);
            }}
          >
            {t('calendarToday')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => shiftMonth(1)}>
            {t('calendarNext')}
          </Button>
        </div>
      </div>

      <DeliveryScheduleLegend />

      <div className="kh-ops-calendar-layout">
        <section className="kh-ops-panel">
          <div className="kh-ops-month">
            {WEEKDAY_KEYS.map((key) => (
              <div key={key} className="kh-ops-day-name">
                {t(`calendarWeekdaysShort.${key}`)}
              </div>
            ))}
            {cells.map((cell) => (
              <div
                key={cell.key}
                className="kh-ops-day"
                data-muted={cell.inMonth ? undefined : 'true'}
                data-selected={cell.iso != null && cell.iso === selectedIso ? 'true' : undefined}
                tabIndex={cell.inMonth ? 0 : undefined}
                onClick={() => {
                  if (cell.inMonth && cell.iso) setSelectedIso(cell.iso);
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (!cell.inMonth || !cell.iso) return;
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  setSelectedIso(cell.iso);
                }}
              >
                {cell.day != null ? <span className="kh-ops-day-num">{cell.day}</span> : null}
                {cell.items.slice(0, 3).map((item) => (
                  <CalendarItemChip
                    key={item.id}
                    item={item}
                    today={today}
                    dense
                    onOpen={onOpenItem ? () => openCalendarItem(item) : undefined}
                  />
                ))}
                {cell.items.length > 3 ? (
                  <span className="kh-ops-menu-type mt-1 block text-ink-muted">
                    {t('calendarMore', { count: cell.items.length - 3 })}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        <section className="kh-ops-panel">
          <div className="kh-ops-panel-head">
            <h2 className="kh-ops-panel-title">
              {selectedIso
                ? `${t(`calendarWeekdays.${weekdayKeyForIso(selectedIso)}`)} ${selectedDayNumber}`
                : t('calendarToday')}
            </h2>
            <span className="kh-ops-panel-meta">
              {t('calendarDayCount', { count: selectedItems.length })}
            </span>
          </div>
          {selectedItems.length === 0 ? (
            <p className="kh-ops-empty">{t('calendarSelectedEmpty')}</p>
          ) : (
            <ul className="kh-ops-stack">
              {selectedItems.map((item) => (
                <CalendarItemChip
                  key={item.id}
                  item={item}
                  today={today}
                  onOpen={onOpenItem ? () => openCalendarItem(item) : undefined}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
