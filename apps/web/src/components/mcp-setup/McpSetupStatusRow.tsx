import { Badge } from '../ui';

export function McpSetupStatusRow({
  ok,
  skipped,
  label,
  detail,
}: {
  ok: boolean;
  skipped?: boolean;
  label: string;
  detail: string;
}) {
  const tone = skipped ? 'neutral' : ok ? 'success' : 'danger';
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-panel-solid px-3 py-2">
      <div>
        <p className="m-0 text-sm font-medium">{label}</p>
        <p className="mt-1 mb-0 text-xs text-ink-muted">{detail}</p>
      </div>
      <Badge tone={tone}>{skipped ? 'skipped' : ok ? 'ok' : 'fail'}</Badge>
    </div>
  );
}
